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

    const { owner, repo, prNumber, body, replyToCommentId } = await req.json();
    if (!body?.trim()) {
      return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
    }

    const octokit = new Octokit({ auth: session.accessToken });

    let result;
    if (replyToCommentId) {
      // Reply to a specific review comment
      result = await octokit.rest.pulls.createReplyForReviewComment({
        owner, repo, pull_number: prNumber,
        comment_id: replyToCommentId,
        body: body.trim(),
      });
    } else {
      // Post a general issue comment on the PR
      result = await octokit.rest.issues.createComment({
        owner, repo, issue_number: prNumber,
        body: body.trim(),
      });
    }

    return NextResponse.json({
      id: result.data.id,
      url: result.data.html_url,
    });
  } catch (error: any) {
    console.error("PR comment error:", error);
    return NextResponse.json({ error: error.message?.slice(0, 200) }, { status: 500 });
  }
}
