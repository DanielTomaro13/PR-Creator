import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Octokit } from "octokit";

export async function POST(req: Request) {
  let owner = "?", repo = "?";
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    owner = body.owner;
    repo = body.repo;
    const { branch, modifications, message } = body;
    console.log(`[pr-update] owner=${owner} repo=${repo} branch=${branch} files=${modifications?.length}`);

    if (!branch || !modifications?.length) {
      return NextResponse.json({ error: "branch and modifications are required" }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    // Use the Contents API (PUT) to update files one at a time.
    // This works reliably with forks, unlike the low-level Git Trees API.
    let lastCommitSha = "";
    const pushed: string[] = [];
    const failed: { path: string; error: string }[] = [];

    for (const mod of modifications) {
      console.log(`[pr-update] Updating file: ${mod.path} on ${owner}/${repo}@${branch}`);
      try {
        // Get the current file SHA (needed for updates)
        let fileSha: string | undefined;
        try {
          const { data: existing } = await octokit.rest.repos.getContent({
            owner, repo, path: mod.path, ref: branch,
          });
          if (!Array.isArray(existing) && existing.sha) {
            fileSha = existing.sha;
          }
        } catch {
          // File doesn't exist yet — will be created
        }

        const result = await octokit.rest.repos.createOrUpdateFileContents({
          owner, repo,
          path: mod.path,
          message: message || `update ${mod.path}`,
          content: Buffer.from(mod.content, "utf-8").toString("base64"),
          branch,
          ...(fileSha ? { sha: fileSha } : {}),
        });

        lastCommitSha = result.data.commit.sha || "";
        pushed.push(mod.path);
        console.log(`[pr-update] Updated ${mod.path}, commit: ${lastCommitSha}`);
      } catch (fileError: any) {
        const msg = fileError?.response?.data?.message || fileError?.message || "Unknown error";
        console.error(`[pr-update] Failed to push ${mod.path}: ${msg}`);
        failed.push({ path: mod.path, error: msg });
      }
    }

    if (pushed.length === 0) {
      return NextResponse.json({
        error: `Failed to push all files. ${failed.map(f => `${f.path}: ${f.error}`).join('; ')}`,
      }, { status: 422 });
    }

    console.log(`[pr-update] Done. Pushed: ${pushed.length}, Failed: ${failed.length}`);
    return NextResponse.json({ sha: lastCommitSha, branch, pushed, failed });
  } catch (error: any) {
    console.error("[pr-update] Error:", error?.status, error?.response?.data || error?.message);
    const detail = error?.response?.data?.message || error?.message || "Unknown error";
    return NextResponse.json({ error: `${detail} (pushing to ${owner}/${repo})` }, { status: error?.status || 500 });
  }
}
