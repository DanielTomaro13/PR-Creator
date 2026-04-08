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

    const { owner, repo, defaultBranch, modifications, title, description } = await req.json();

    if (!modifications || modifications.length === 0) {
      return NextResponse.json({ error: "No modifications provided" }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    // Determine if we need to fork (user doesn't own the repo)
    const { data: currentUser } = await octokit.rest.users.getAuthenticated();
    const isOwnRepo = currentUser.login.toLowerCase() === owner.toLowerCase();

    let targetOwner = owner;
    let headPrefix = "";

    if (!isOwnRepo) {
      // Fork the repo — GitHub returns the existing fork if one already exists
      console.log(`Forking ${owner}/${repo} for cross-repo PR...`);
      const { data: fork } = await octokit.rest.repos.createFork({
        owner,
        repo,
      });
      targetOwner = fork.owner.login;
      headPrefix = `${targetOwner}:`;
      console.log(`Fork created/found: ${targetOwner}/${repo}`);

      // Poll until fork is ready (GitHub can take up to ~30s to provision)
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          await octokit.rest.git.getRef({
            owner: targetOwner,
            repo,
            ref: `heads/${defaultBranch}`,
          });
          console.log(`Fork ready on attempt ${attempt + 1}`);
          break;
        } catch {
          console.log(`Fork not ready yet, waiting... (attempt ${attempt + 1}/15)`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    // 1. Get latest commit SHA of default branch from the target (fork or original)
    const { data: refData } = await octokit.rest.git.getRef({
      owner: targetOwner,
      repo,
      ref: `heads/${defaultBranch}`,
    });
    const latestCommitSha = refData.object.sha;

    // 2. Create a new branch on the target
    const newBranchName = `fix-${Date.now()}`;
    await octokit.rest.git.createRef({
      owner: targetOwner,
      repo,
      ref: `refs/heads/${newBranchName}`,
      sha: latestCommitSha,
    });

    // 3. Create blobs for each modified file
    const treeItems = [];
    for (const mod of modifications) {
      const { data: blobData } = await octokit.rest.git.createBlob({
        owner: targetOwner,
        repo,
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

    // 4. Create a new tree
    const { data: treeData } = await octokit.rest.git.createTree({
      owner: targetOwner,
      repo,
      base_tree: latestCommitSha,
      tree: treeItems,
    });

    // 5. Create a commit
    const { data: commitData } = await octokit.rest.git.createCommit({
      owner: targetOwner,
      repo,
      message: title || "Automated fix",
      tree: treeData.sha,
      parents: [latestCommitSha],
    });

    // 6. Update the branch ref
    await octokit.rest.git.updateRef({
      owner: targetOwner,
      repo,
      ref: `heads/${newBranchName}`,
      sha: commitData.sha,
    });

    // 7. Create Pull Request (always targets the original repo)
    const { data: prData } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: title || "Automated fix",
      head: `${headPrefix}${newBranchName}`,
      base: defaultBranch,
      body: description || "This pull request was automatically generated.",
    });

    return NextResponse.json({ url: prData.html_url, branch: newBranchName, targetOwner });
  } catch (error: any) {
    console.error("PR submission error:", error);
    const msg = error.message?.length > 200 ? error.message.slice(0, 200) + "..." : error.message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
