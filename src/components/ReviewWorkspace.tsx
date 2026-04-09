"use client";

import { useState, useEffect, useRef } from "react";
import * as Diff2Html from "diff2html";

interface ReviewPR {
  url: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
}

interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
  content: string;
  previousFilename?: string;
}

interface ReviewComment {
  id: string;
  path: string;
  line: number;
  body: string;
  included: boolean;
}

const CodeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
);

const CpuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M15 2v2" /><path d="M15 20v2" /><path d="M2 15h2" /><path d="M2 9h2" /><path d="M20 15h2" /><path d="M20 9h2" /><path d="M9 2v2" /><path d="M9 20v2" /></svg>
);

export function ReviewWorkspace({ reviewPR, onReset }: { reviewPR: ReviewPR; onReset: () => void }) {
  const [modelId, setModelId] = useState("gemini-2.5-pro");
  const [prData, setPrData] = useState<any>(null);
  const [files, setFiles] = useState<PRFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // AI Review state
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewSummary, setReviewSummary] = useState("");
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [reviewLogs, setReviewLogs] = useState<string[]>([]);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewEvent, setReviewEvent] = useState<"COMMENT" | "APPROVE" | "REQUEST_CHANGES">("COMMENT");
  const [overallComment, setOverallComment] = useState("");
  const [submitResult, setSubmitResult] = useState<any>(null);

  // Existing reviews/comments
  const [existingReviews, setExistingReviews] = useState<any>(null);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [reviewLogs]);

  // Fetch PR diff on mount
  useEffect(() => {
    setLoading(true);
    fetch("/api/github/pr-diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: reviewPR.owner, repo: reviewPR.repo, prNumber: reviewPR.number }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setPrData(data.pr);
        setFiles(data.files || []);
        // Auto-expand first 3 files
        const first3 = (data.files || []).slice(0, 3).map((f: any) => f.filename);
        setExpandedFiles(new Set(first3));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));

    // Also fetch existing reviews
    fetch("/api/github/pr-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: reviewPR.owner, repo: reviewPR.repo, prNumber: reviewPR.number }),
    })
      .then(r => r.json())
      .then(data => { if (!data.error) setExistingReviews(data); })
      .catch(() => {});
  }, [reviewPR]);

  const toggleFile = (filename: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const renderFileDiff = (file: PRFile) => {
    if (!file.patch) return <div style={{ padding: '0.5rem', color: 'var(--muted)', fontSize: '0.8rem' }}>Binary file or no diff available</div>;
    const diffStr = `--- a/${file.filename}\n+++ b/${file.filename}\n${file.patch}`;
    const html = Diff2Html.html(diffStr, {
      drawFileList: false,
      matching: "lines",
      outputFormat: "line-by-line",
      colorScheme: "dark" as any,
    });
    return <div className="diff-viewer" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const handleRunReview = async () => {
    setIsReviewing(true);
    setReviewSummary("");
    setReviewComments([]);
    setReviewLogs([]);
    setError("");

    try {
      // Build the diff context for the AI
      const diffContext = files.map(f =>
        `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n\`\`\`diff\n${f.patch || '(no diff)'}\n\`\`\``
      ).join("\n\n");

      const prompt = `Review this Pull Request:\n\nTitle: ${prData?.title || reviewPR.title}\nAuthor: ${prData?.author || 'unknown'}\nDescription: ${prData?.body || 'No description'}\n\nBranch: ${prData?.branch || '?'} → ${prData?.baseBranch || '?'}\nFiles changed: ${files.length} (+${prData?.additions || 0} -${prData?.deletions || 0})\n\n${diffContext}`;

      setReviewLogs(prev => [...prev, `Starting AI review with ${modelId}...`]);

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: reviewPR.owner,
          repo: reviewPR.repo,
          defaultBranch: prData?.baseBranch || "main",
          files: files.map(f => f.filename),
          prompt,
          modelId,
          mode: "review",
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          const eventMatch = block.match(/^event: (.+)\ndata: (.+)$/m);
          if (!eventMatch) continue;
          const [, event, dataStr] = eventMatch;
          try {
            const data = JSON.parse(dataStr);
            switch (event) {
              case "status":
                setReviewLogs(prev => [...prev, data.message]);
                break;
              case "tool":
                setReviewLogs(prev => [...prev, `📂 Reading ${data.path || data.function || '...'}`]);
                break;
              case "tool_done":
                setReviewLogs(prev => [...prev, `✓ ${data.function || 'Done'}`]);
                break;
              case "result":
                if (data.summary) setReviewSummary(data.summary);
                if (data.comments) {
                  setReviewComments(data.comments.map((c: any, i: number) => ({
                    id: `review-${i}`,
                    path: c.path,
                    line: c.line,
                    body: c.body,
                    included: true,
                  })));
                }
                setReviewLogs(prev => [...prev, `✓ Review complete! ${data.comments?.length || 0} inline comments generated.`]);
                break;
              case "error":
                setError(data.message);
                setReviewLogs(prev => [...prev, `✗ ${data.message}`]);
                break;
            }
          } catch { /* skip parse errors */ }
        }
      }
    } catch (err: any) {
      setError(err.message);
      setReviewLogs(prev => [...prev, `✗ ${err.message}`]);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleSubmitReview = async () => {
    setIsSubmitting(true);
    setError("");
    setSubmitResult(null);

    try {
      const activeComments = reviewComments.filter(c => c.included);

      const res = await fetch("/api/github/pr-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: reviewPR.owner,
          repo: reviewPR.repo,
          prNumber: reviewPR.number,
          event: reviewEvent,
          body: overallComment || reviewSummary || "Code review",
          comments: activeComments.map(c => ({ path: c.path, line: c.line, body: c.body })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit review");
      setSubmitResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusColors: Record<string, string> = {
    added: "var(--success)",
    removed: "var(--error)",
    modified: "var(--accent)",
    renamed: "var(--primary)",
  };

  if (loading) {
    return (
      <div className="page-workspace animate-fade-in" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3, margin: '0 auto' }} />
          <p style={{ color: 'var(--muted)', marginTop: '1rem', fontSize: '0.9rem' }}>Loading PR diff...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-workspace animate-fade-in">
      {/* Sidebar */}
      <div className="sidebar">
        {/* Home link */}
        <button
          onClick={onReset}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none',
            color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700,
            padding: '0.5rem 0', fontFamily: 'inherit', marginBottom: '0.25rem',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          <span className="text-gradient" style={{ fontSize: '0.95rem' }}>Home</span>
        </button>

        {/* PR Info */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <h2 className="section-title" style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
            <CodeIcon /> Review Mode
          </h2>
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{reviewPR.owner}/{reviewPR.repo}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>#{reviewPR.number} {prData?.title || reviewPR.title}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
            by {prData?.author || '...'} • {prData?.branch || '...'} → {prData?.baseBranch || '...'}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--success)' }}>+{prData?.additions || 0}</span>
            <span style={{ color: 'var(--error)' }}>-{prData?.deletions || 0}</span>
            <span style={{ color: 'var(--muted)' }}>{files.length} files</span>
          </div>
          <a href={reviewPR.url} target="_blank" rel="noopener" style={{ fontSize: '0.72rem', color: 'var(--primary)', marginTop: '0.5rem', display: 'block' }}>
            View on GitHub ↗
          </a>
        </div>

        {/* Changed Files list */}
        <div className="glass-panel" style={{ padding: '1rem', maxHeight: '300px', overflowY: 'auto' }}>
          <h3 className="section-title" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>Changed Files</h3>
          {files.map(f => (
            <div
              key={f.filename}
              onClick={() => toggleFile(f.filename)}
              style={{
                fontSize: '0.75rem', padding: '0.25rem 0.4rem', cursor: 'pointer', borderRadius: '4px',
                background: expandedFiles.has(f.filename) ? 'rgba(255,255,255,0.05)' : 'transparent',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ color: statusColors[f.status] || 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.filename.split('/').pop()}
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--muted)', flexShrink: 0 }}>
                +{f.additions} -{f.deletions}
              </span>
            </div>
          ))}
        </div>

        {/* Existing reviews */}
        {existingReviews?.reviews?.length > 0 && (
          <div className="glass-panel" style={{ padding: '1rem' }}>
            <h3 className="section-title" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>Reviews</h3>
            {existingReviews.reviews.map((r: any) => (
              <div key={r.id} style={{ fontSize: '0.75rem', padding: '0.25rem 0', borderBottom: '1px solid var(--surface-border)' }}>
                <span style={{ fontWeight: 600 }}>{r.user}</span>
                <span style={{
                  marginLeft: '0.4rem', fontSize: '0.65rem', padding: '1px 4px', borderRadius: '999px',
                  background: r.state === 'APPROVED' ? 'rgba(52,211,153,0.15)' : r.state === 'CHANGES_REQUESTED' ? 'rgba(239,68,68,0.15)' : 'rgba(107,114,128,0.15)',
                  color: r.state === 'APPROVED' ? 'var(--success)' : r.state === 'CHANGES_REQUESTED' ? 'var(--error)' : 'var(--muted)',
                }}>
                  {r.state.replace('_', ' ')}
                </span>
                {r.body && <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '0.15rem', whiteSpace: 'pre-wrap' }}>{r.body.slice(0, 150)}</div>}
              </div>
            ))}
          </div>
        )}

        {/* CI / Checks */}
        {existingReviews?.checkRuns?.length > 0 && (
          <div className="glass-panel" style={{ padding: '1rem' }}>
            <h3 className="section-title" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>CI / Checks</h3>
            {existingReviews.checkRuns.map((check: any) => {
              const icon = check.conclusion === 'success' ? '✓' : check.conclusion === 'failure' ? '✗' : '○';
              const color = check.conclusion === 'success' ? 'var(--success)' : check.conclusion === 'failure' ? 'var(--error)' : 'var(--muted)';
              return (
                <div key={check.id} style={{ fontSize: '0.72rem', padding: '0.2rem 0', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color }}>{icon} {check.name}</span>
                  {check.conclusion === 'failure' && check.annotations?.length > 0 && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--error)' }}>{check.annotations.length} issue(s)</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Comments */}
        {(existingReviews?.issueComments?.length > 0 || existingReviews?.reviewComments?.length > 0) && (
          <div className="glass-panel" style={{ padding: '1rem', maxHeight: '250px', overflowY: 'auto' }}>
            <h3 className="section-title" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>
              Comments ({(existingReviews?.issueComments?.length || 0) + (existingReviews?.reviewComments?.length || 0)})
            </h3>
            {existingReviews?.issueComments?.map((c: any) => (
              <div key={c.id} style={{ fontSize: '0.72rem', padding: '0.3rem 0', borderBottom: '1px solid var(--surface-border)' }}>
                <div><span style={{ fontWeight: 600 }}>{c.user}</span> <span style={{ color: 'var(--muted)', fontSize: '0.6rem' }}>{new Date(c.createdAt).toLocaleDateString()}</span></div>
                <div style={{ color: 'var(--muted)', marginTop: '0.1rem', whiteSpace: 'pre-wrap' }}>{c.body?.slice(0, 200)}</div>
              </div>
            ))}
            {existingReviews?.reviewComments?.map((c: any) => (
              <div key={c.id} style={{ fontSize: '0.72rem', padding: '0.3rem 0', borderBottom: '1px solid var(--surface-border)' }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{c.user}</span>
                  <code style={{ marginLeft: '0.3rem', fontSize: '0.6rem', color: 'var(--accent)' }}>{c.path}:{c.line}</code>
                </div>
                <div style={{ color: 'var(--muted)', marginTop: '0.1rem', whiteSpace: 'pre-wrap' }}>{c.body?.slice(0, 200)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Review Activity Log */}
        {reviewLogs.length > 0 && (
          <div className="glass-panel" style={{ padding: '1rem', maxHeight: '200px', overflowY: 'auto' }}>
            <h3 className="section-title" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>Activity</h3>
            {reviewLogs.map((log, i) => (
              <div key={i} style={{ fontSize: '0.7rem', color: log.startsWith('✗') ? 'var(--error)' : log.startsWith('✓') ? 'var(--success)' : 'var(--muted)', padding: '1px 0' }}>
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Main Area */}
      <div className="main-area">
        {error && <div className="error-text" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        {/* AI Review Controls */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={handleRunReview}
                disabled={isReviewing || files.length === 0}
                className="btn-primary"
                style={{ padding: '0.6rem 1.2rem' }}
              >
                {isReviewing ? (
                  <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Reviewing...</>
                ) : (
                  <>🔍 Run AI Review</>
                )}
              </button>
              <div className="model-selector">
                <CpuIcon />
                <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  <option value="claude-opus-4-6">Claude Opus 4.6</option>
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              {files.length} files • +{prData?.additions || 0} -{prData?.deletions || 0} lines
            </div>
          </div>
        </div>

        {/* AI Review Summary */}
        {reviewSummary && (
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>AI Review Summary</h3>
            <div style={{ fontSize: '0.85rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{reviewSummary}</div>
          </div>
        )}

        {/* Review Comments (editable) */}
        {reviewComments.length > 0 && (
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Review Comments ({reviewComments.filter(c => c.included).length}/{reviewComments.length})</h3>
              <button
                onClick={() => setReviewComments(prev => prev.map(c => ({ ...c, included: !prev.every(p => p.included) })))}
                style={{ fontSize: '0.7rem', background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {reviewComments.every(c => c.included) ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {reviewComments.map((comment) => (
                <div
                  key={comment.id}
                  style={{
                    padding: '0.6rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)',
                    borderLeft: `3px solid ${comment.included ? 'var(--primary)' : 'var(--muted)'}`,
                    opacity: comment.included ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <code style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>{comment.path}:{comment.line}</code>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', cursor: 'pointer', color: 'var(--muted)' }}>
                      <input
                        type="checkbox"
                        checked={comment.included}
                        onChange={() => setReviewComments(prev => prev.map(c => c.id === comment.id ? { ...c, included: !c.included } : c))}
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      include
                    </label>
                  </div>
                  <textarea
                    value={comment.body}
                    onChange={(e) => setReviewComments(prev => prev.map(c => c.id === comment.id ? { ...c, body: e.target.value } : c))}
                    style={{
                      width: '100%', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--surface-border)',
                      borderRadius: '4px', padding: '0.4rem', color: 'var(--foreground)', fontFamily: 'inherit',
                      minHeight: '3rem', resize: 'vertical',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit Review */}
        {(reviewSummary || reviewComments.length > 0) && !submitResult && (
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>Submit Review</h3>
            <textarea
              value={overallComment}
              onChange={(e) => setOverallComment(e.target.value)}
              placeholder="Overall review comment (optional — defaults to AI summary)"
              style={{
                width: '100%', fontSize: '0.85rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-sm)', padding: '0.75rem', color: 'var(--foreground)', fontFamily: 'inherit',
                minHeight: '4rem', resize: 'vertical', marginBottom: '0.75rem',
              }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={reviewEvent}
                onChange={(e) => setReviewEvent(e.target.value as any)}
                style={{
                  fontSize: '0.85rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)',
                  background: 'rgba(0,0,0,0.3)', border: '1px solid var(--surface-border)',
                  color: 'var(--foreground)', fontFamily: 'inherit',
                }}
              >
                <option value="COMMENT">💬 Comment</option>
                <option value="APPROVE">✅ Approve</option>
                <option value="REQUEST_CHANGES">🔄 Request Changes</option>
              </select>
              <button
                onClick={handleSubmitReview}
                disabled={isSubmitting}
                className="btn-primary"
                style={{ padding: '0.5rem 1.5rem' }}
              >
                {isSubmitting ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Submitting...</> : 'Submit Review'}
              </button>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                {reviewComments.filter(c => c.included).length} inline comment(s) will be included
              </span>
            </div>
          </div>
        )}

        {/* Submit Result */}
        {submitResult && (
          <div className="glass-panel" style={{ padding: '1.25rem', borderLeft: '3px solid var(--success)' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.5rem' }}>✓ Review submitted!</div>
            <a href={submitResult.url} target="_blank" rel="noopener" style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>
              View on GitHub ↗
            </a>
          </div>
        )}

        {/* File Diffs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {files.map(file => (
            <div key={file.filename} className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                onClick={() => toggleFile(file.filename)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.7rem 1rem', cursor: 'pointer',
                  borderLeft: `3px solid ${statusColors[file.status] || 'var(--muted)'}`,
                  background: expandedFiles.has(file.filename) ? 'rgba(255,255,255,0.02)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expandedFiles.has(file.filename) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}><polyline points="9 18 15 12 9 6" /></svg>
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{file.filename}</span>
                  {file.status === 'renamed' && file.previousFilename && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>← {file.previousFilename}</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.7rem' }}>
                  <span style={{ color: 'var(--success)' }}>+{file.additions}</span>
                  <span style={{ color: 'var(--error)' }}>-{file.deletions}</span>
                  <span style={{
                    padding: '0 4px', borderRadius: '999px', fontSize: '0.6rem',
                    background: statusColors[file.status] ? `${statusColors[file.status]}22` : 'rgba(107,114,128,0.15)',
                    color: statusColors[file.status] || 'var(--muted)',
                  }}>
                    {file.status}
                  </span>
                </div>
              </div>
              {expandedFiles.has(file.filename) && (
                <div style={{ borderTop: '1px solid var(--surface-border)', maxHeight: '500px', overflowY: 'auto' }}>
                  {renderFileDiff(file)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
