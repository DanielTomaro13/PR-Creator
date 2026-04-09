import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Octokit } from "octokit";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { owner, repo, prNumber } = await req.json();
    const octokit = new Octokit({ auth: session.accessToken });

    // Fetch PR metadata
    const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });

    // Fetch changed files with patches (up to 100 files)
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner, repo, pull_number: prNumber, per_page: 100,
    });

    // For each file, try to get its full content at the PR head SHA
    const filesWithContent = await Promise.all(
      files.map(async (f) => {
        let content = "";
        // Only fetch content for non-deleted, non-binary files under 100KB
        if (f.status !== "removed" && !f.filename.match(/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|svg|pdf|zip|tar|gz|bin|exe|dll|so|dylib)$/i)) {
          try {
            const { data } = await octokit.rest.repos.getContent({
              owner: pr.head.repo?.owner?.login || owner,
              repo: pr.head.repo?.name || repo,
              path: f.filename,
              ref: pr.head.sha,
            });
            if (!Array.isArray(data) && data.content) {
              content = Buffer.from(data.content, "base64").toString("utf-8");
            }
          } catch {
            // File might not be accessible
          }
        }

        return {
          filename: f.filename,
          status: f.status, // added | removed | modified | renamed
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
          patch: f.patch?.slice(0, 5000) || "", // truncate large patches
          content: content.slice(0, 10000), // truncate large files
          previousFilename: f.previous_filename,
        };
      })
    );

    return NextResponse.json({
      pr: {
        title: pr.title,
        body: pr.body?.slice(0, 3000) || "",
        author: pr.user?.login || "unknown",
        state: pr.state,
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        headSha: pr.head.sha,
        headOwner: pr.head.repo?.owner?.login || owner,
        headRepo: pr.head.repo?.name || repo,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        mergeable: pr.mergeable,
      },
      files: filesWithContent,
    });
  } catch (error: any) {
    console.error("PR diff error:", error);
    return NextResponse.json({ error: error.message?.slice(0, 200) }, { status: 500 });
  }
}
