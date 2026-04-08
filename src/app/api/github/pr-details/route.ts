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

    // Fetch PR details
    const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });

    // Fetch review comments (inline code comments)
    const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
      owner, repo, pull_number: prNumber, per_page: 50,
    });

    // Fetch issue comments (general PR conversation)
    const { data: issueComments } = await octokit.rest.issues.listComments({
      owner, repo, issue_number: prNumber, per_page: 50,
    });

    // Fetch reviews (approve/request changes)
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner, repo, pull_number: prNumber, per_page: 20,
    });

    // Fetch check runs for the PR head SHA
    let checkRuns: any[] = [];
    try {
      const { data: checks } = await octokit.rest.checks.listForRef({
        owner, repo, ref: pr.head.sha, per_page: 50,
      });

      checkRuns = await Promise.all(checks.check_runs.map(async (run: any) => {
        const result: any = {
          id: run.id,
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
          url: run.html_url,
          output: run.output?.summary?.slice(0, 1000) || "",
          annotations: [],
          logs: "",
        };

        // For failing checks, fetch annotations (contain test error details)
        if (run.conclusion === 'failure' || run.conclusion === 'action_required') {
          try {
            const { data: annotations } = await octokit.rest.checks.listAnnotations({
              owner, repo, check_run_id: run.id, per_page: 30,
            });
            result.annotations = annotations.map((a: any) => ({
              path: a.path,
              startLine: a.start_line,
              endLine: a.end_line,
              level: a.annotation_level,
              message: a.message,
              title: a.title || "",
            }));
          } catch { /* annotations may not be available */ }

          // Try to fetch job logs for this failing check
          try {
            // Find the workflow run associated with this check
            const { data: workflowRuns } = await octokit.rest.actions.listWorkflowRunsForRepo({
              owner, repo, head_sha: pr.head.sha, per_page: 5,
            });
            for (const wfRun of workflowRuns.workflow_runs) {
              const { data: jobs } = await octokit.rest.actions.listJobsForWorkflowRun({
                owner, repo, run_id: wfRun.id,
              });
              const matchingJob = jobs.jobs.find((j: any) => j.name === run.name && j.conclusion === 'failure');
              if (matchingJob) {
                try {
                  const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
                    owner, repo, job_id: matchingJob.id,
                  });
                  // logResponse.data is the log text (can be large), truncate to last 3000 chars
                  const logText = typeof logResponse.data === 'string' ? logResponse.data : String(logResponse.data);
                  result.logs = logText.slice(-3000);
                } catch { /* log download may fail */ }
                break;
              }
            }
          } catch { /* workflow run lookup may fail */ }
        }

        return result;
      }));
    } catch { /* checks API might not be available */ }

    // Format review comments
    const formattedReviewComments = reviewComments.map((c: any) => ({
      id: c.id,
      user: c.user?.login || "unknown",
      body: c.body,
      path: c.path,
      line: c.line || c.original_line,
      createdAt: c.created_at,
      diffHunk: c.diff_hunk?.slice(0, 300),
    }));

    // Format issue comments
    const formattedIssueComments = issueComments.map((c: any) => ({
      id: c.id,
      user: c.user?.login || "unknown",
      body: c.body,
      createdAt: c.created_at,
    }));

    // Format reviews
    const formattedReviews = reviews
      .filter((r: any) => r.state !== "PENDING")
      .map((r: any) => ({
        id: r.id,
        user: r.user?.login || "unknown",
        state: r.state,
        body: r.body || "",
        createdAt: r.submitted_at,
      }));

    return NextResponse.json({
      title: pr.title,
      body: pr.body,
      state: pr.state,
      branch: pr.head.ref,
      baseBranch: pr.base.ref,
      reviewComments: formattedReviewComments,
      issueComments: formattedIssueComments,
      reviews: formattedReviews,
      checkRuns,
      filesChanged: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
    });
  } catch (error: any) {
    console.error("PR details error:", error);
    return NextResponse.json({ error: error.message?.slice(0, 200) }, { status: 500 });
  }
}
