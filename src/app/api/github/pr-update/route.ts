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

    const { owner, repo, branch, modifications, message } = await req.json();
    if (!branch || !modifications?.length) {
      return NextResponse.json({ error: "branch and modifications are required" }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    // 1. Get the latest commit on the PR branch
    const { data: refData } = await octokit.rest.git.getRef({
      owner, repo,
      ref: `heads/${branch}`,
    });
    const latestCommitSha = refData.object.sha;

    // 1b. Get the tree SHA from the latest commit
    const { data: commitInfo } = await octokit.rest.git.getCommit({
      owner, repo,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitInfo.tree.sha;

    // 2. Create blobs for each modified file
    const treeItems = [];
    for (const mod of modifications) {
      const { data: blobData } = await octokit.rest.git.createBlob({
        owner, repo,
        content: Buffer.from(mod.content, "utf-8").toString("base64"),
        encoding: "base64",
      });
      treeItems.push({
        path: mod.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blobData.sha,
      });
    }

    // 3. Create a new tree based on the latest commit's tree
    const { data: treeData } = await octokit.rest.git.createTree({
      owner, repo,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    // 4. Create a new commit on top of the PR branch
    const { data: commitData } = await octokit.rest.git.createCommit({
      owner, repo,
      message: message || "PR-Creator: iterative fix",
      tree: treeData.sha,
      parents: [latestCommitSha],
    });

    // 5. Update the branch ref to point to the new commit
    await octokit.rest.git.updateRef({
      owner, repo,
      ref: `heads/${branch}`,
      sha: commitData.sha,
    });

    return NextResponse.json({ sha: commitData.sha, branch });
  } catch (error: any) {
    console.error("PR update error:", error);
    return NextResponse.json({ error: error.message?.slice(0, 200) }, { status: 500 });
  }
}
