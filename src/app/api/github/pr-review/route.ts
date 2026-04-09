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

    const { owner, repo, prNumber, event, body, comments } = await req.json();

    if (!event || !["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(event)) {
      return NextResponse.json({ error: "event must be APPROVE, REQUEST_CHANGES, or COMMENT" }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    // Get the latest commit SHA for the review
    const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });

    // Build review comments (inline comments on specific lines)
    const reviewComments = (comments || []).map((c: any) => ({
      path: c.path,
      line: c.line,
      body: c.body,
      side: "RIGHT" as const,
    }));

    // Submit the review
    const { data: review } = await octokit.rest.pulls.createReview({
      owner, repo,
      pull_number: prNumber,
      commit_id: pr.head.sha,
      event,
      body: body || "",
      comments: reviewComments.length > 0 ? reviewComments : undefined,
    });

    return NextResponse.json({
      id: review.id,
      url: review.html_url,
      state: review.state,
    });
  } catch (error: any) {
    console.error("PR review error:", error?.response?.data || error);
    const detail = error?.response?.data?.message || error?.message || "Unknown error";
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: error?.status || 500 });
  }
}
