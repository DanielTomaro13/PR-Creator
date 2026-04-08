import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import { Octokit } from "octokit";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const octokit = new Octokit({ auth: session.accessToken });
    const { data: user } = await octokit.rest.users.getAuthenticated();

    // Search for PRs created by this user with "PR-Creator" in the title
    const { data: searchResult } = await octokit.rest.search.issuesAndPullRequests({
      q: `author:${user.login} type:pr "PR-Creator" in:title`,
      sort: "created",
      order: "desc",
      per_page: 20,
    });

    const prs = searchResult.items.map((item: any) => {
      // Extract owner/repo from the repo URL
      const repoMatch = item.repository_url?.match(/repos\/(.+)\/(.+)/);
      return {
        id: item.id,
        number: item.number,
        title: item.title,
        repo: repoMatch ? `${repoMatch[1]}/${repoMatch[2]}` : "unknown",
        state: item.pull_request?.merged_at ? "merged" : item.state,
        url: item.html_url,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      };
    });

    return NextResponse.json({ prs, username: user.login });
  } catch (error: any) {
    console.error("PR history error:", error);
    return NextResponse.json({ error: error.message?.slice(0, 200) }, { status: 500 });
  }
}
