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

    const { repoUrl } = await req.json();
    if (!repoUrl) {
      return NextResponse.json({ error: "Missing repoUrl" }, { status: 400 });
    }

    // Extract owner and repo from URL
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
      return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
    }
    
    // Clean up .git suffix if present
    const owner = match[1];
    const repo = match[2].replace(/\.git$/, "");

    const octokit = new Octokit({ auth: session.accessToken });

    // 1. Get Repo Details
    const { data: repoData } = await octokit.rest.repos.get({
      owner,
      repo,
    });

    const defaultBranch = repoData.default_branch;

    // 2. Get Tree (recursive, to let Claude see the whole structure)
    const { data: treeData } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: "1",
    });

    // Extract just file paths and remove large non-code directories like node_modules
    const filePaths = treeData.tree
      .filter((item) => item.type === "blob")
      .map((item) => item.path)
      .filter((path) => path && !path.includes("node_modules") && !path.includes(".git/"));

    // 3. Get Open Issues
    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: "open",
      sort: "updated",
      per_page: 15,
    });

    return NextResponse.json({
      owner,
      repo,
      defaultBranch,
      description: repoData.description,
      files: filePaths,
      issues: issues.filter((issue) => !issue.pull_request).map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body,
        html_url: i.html_url,
      })),
    });
  } catch (error: any) {
    console.error("Scan error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
