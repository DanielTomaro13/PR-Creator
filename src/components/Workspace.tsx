"use client";

import { useState, useRef, useEffect } from "react";
import * as Diff from "diff";
import * as Diff2Html from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";

interface Issue {
  number: number;
  title: string;
  body: string;
  html_url: string;
}

export interface RepoContext {
  owner: string;
  repo: string;
  defaultBranch: string;
  description: string;
  files: string[];
  issues: Issue[];
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  provider: string;
}

interface LogEntry {
  id: string;
  type: "status" | "tool" | "tool_done" | "tool_error" | "usage" | "error";
  message: string;
  timestamp: Date;
}

/* ── Inline SVG Icons ── */
const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3" /></svg>
);
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
);
const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const GitPRIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><line x1="6" y1="9" x2="6" y2="21" /></svg>
);
const CodeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
);
const AlertIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
);
const ActivityIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
);
const CpuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" /></svg>
);
const FileIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
);
const TerminalIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
);

export function Workspace({ repoContext, onReset, activePR }: { repoContext: RepoContext; onReset: () => void; activePR?: { url: string; title: string; number: number; owner: string; repo: string } | null }) {
  const [modelId, setModelId] = useState("gemini-2.5-pro");
  const [prompt, setPrompt] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [modifications, setModifications] = useState<{ path: string; originalContent: string; content: string }[] | null>(null);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(activePR?.url || null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [rawResponse, setRawResponse] = useState("");
  const [prBranch, setPrBranch] = useState("");
  const [repoExplanation, setRepoExplanation] = useState("");
  const [isExplaining, setIsExplaining] = useState(false);
  const [prDetails, setPrDetails] = useState<any>(null);
  const [loadingPRDetails, setLoadingPRDetails] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Auto-fetch PR details when opened from an active PR
  useEffect(() => {
    if (activePR?.number) {
      setLoadingPRDetails(true);
      fetch("/api/github/pr-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: activePR.owner, repo: activePR.repo, prNumber: activePR.number }),
      })
        .then(r => r.json())
        .then(data => { if (!data.error) setPrDetails(data); })
        .catch(() => {})
        .finally(() => setLoadingPRDetails(false));
    }
  }, [activePR?.number]);

  const handlePostComment = async (replyToId?: number) => {
    if (!commentText.trim() || !activePR) return;
    setPostingComment(true);
    try {
      await fetch("/api/github/pr-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: activePR.owner, repo: activePR.repo, prNumber: activePR.number,
          body: commentText, replyToCommentId: replyToId,
        }),
      });
      setCommentText("");
      // Refresh PR details
      const res = await fetch("/api/github/pr-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: activePR.owner, repo: activePR.repo, prNumber: activePR.number }),
      });
      const data = await res.json();
      if (!data.error) setPrDetails(data);
    } catch { /* ignore */ }
    finally { setPostingComment(false); }
  };

  // Manual repo explanation
  const handleExplainRepo = () => {
    setIsExplaining(true);
    setRepoExplanation("");
    fetch("/api/github/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: repoContext.owner,
        repo: repoContext.repo,
        defaultBranch: repoContext.defaultBranch,
        files: repoContext.files,
        description: repoContext.description,
        modelId,
      }),
    })
      .then(r => r.json())
      .then(data => setRepoExplanation(data.explanation || ""))
      .catch(() => {})
      .finally(() => setIsExplaining(false));
  };

  const addLog = (type: LogEntry["type"], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLogs(prev => [...prev, { id, type, message, timestamp: new Date() }]);
  };

  // Persist session to localStorage on key state changes
  useEffect(() => {
    const session = {
      id: sessionStorage.getItem('pr-creator-session-id') || `session-${Date.now()}`,
      repo: `${repoContext.owner}/${repoContext.repo}`,
      prompt, modelId, logs, modifications, usage, summary, rawResponse, error,
      status: isAgentRunning ? 'running' : modifications ? 'complete' : error ? 'failed' : 'idle',
      timestamp: new Date().toISOString(),
    };
    sessionStorage.setItem('pr-creator-session-id', session.id);
    try {
      const allSessions = JSON.parse(localStorage.getItem('pr-creator-sessions') || '{}');
      allSessions[session.id] = session;
      localStorage.setItem('pr-creator-sessions', JSON.stringify(allSessions));
    } catch { /* localStorage full or unavailable */ }
  }, [modifications, usage, error, isAgentRunning, summary, rawResponse]);

  const handleRunAgent = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!prompt) return;
    setIsAgentRunning(true);
    setModifications(null);
    setUsage(null);
    setError("");
    setLogs([]);
    setSummary("");
    setRawResponse("");
    setPrUrl(null);

    addLog("status", `Starting agent with ${modelId}...`);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoContext.owner,
          repo: repoContext.repo,
          defaultBranch: repoContext.defaultBranch,
          files: repoContext.files,
          prompt,
          modelId,
          reviewFeedback: reviewFeedback || undefined,
          previousModifications: modifications?.map(m => ({ path: m.path, content: m.content })) || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Agent failed");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (!reader) throw new Error("No readable stream");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line in buffer

        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(currentEvent, data);
            } catch { /* ignore parse errors */ }
            currentEvent = "";
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        addLog("status", "Agent stopped by user.");
      } else {
        const msg = err.message?.length > 200 ? err.message.slice(0, 200) + "..." : err.message;
        setError(msg);
        addLog("error", msg);
      }
    } finally {
      abortControllerRef.current = null;
      setIsAgentRunning(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const handleSSEEvent = (event: string, data: any) => {
    switch (event) {
      case "status":
        addLog("status", data.message);
        break;
      case "tool":
        addLog("tool", `Reading file: ${data.path}`);
        break;
      case "tool_done":
        addLog("tool_done", `✓ Read ${data.path} (${(data.size / 1024).toFixed(1)} KB)`);
        break;
      case "tool_error":
        addLog("tool_error", `✗ Failed to read ${data.path}: ${data.error}`);
        break;
      case "usage":
        setUsage({
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          estimatedCostUsd: data.estimatedCostUsd ?? 0,
          provider: data.provider,
        });
        break;
      case "result":
        setModifications(data.modifications);
        setSummary(data.summary || "");
        setUsage(data.usage);
        addLog("status", `✓ Done! ${data.modifications.length} file(s) modified.`);
        break;
      case "raw_response":
        setRawResponse(data.text || "");
        break;
      case "error":
        setError(data.message);
        addLog("error", data.message);
        break;
    }
  };

  const handleSubmitPR = async () => {
    if (!modifications) return;
    setIsSubmitting(true);
    setError("");
    const isUpdate = !!(activePR && prDetails?.branch);

    try {
      if (isUpdate) {
        const res = await fetch("/api/github/pr-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: prDetails.headOwner || activePR!.owner, repo: prDetails.headRepo || activePR!.repo,
            branch: prDetails.branch, modifications,
            message: `fix: ${prompt.split('\n')[0].slice(0, 68)}`,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update PR");
        setPrUrl(activePR!.url);
        setPrBranch(prDetails.branch);
        if (data.failed?.length > 0) {
          addLog("tool_done", `✓ Pushed ${data.pushed?.length} file(s) to ${prDetails.branch}`);
          addLog("tool_error", `⚠ Failed to push ${data.failed.length} file(s): ${data.failed.map((f: any) => f.path).join(', ')}. For .github/workflows/ files, revoke the app at github.com/settings/applications and re-sign-in.`);
        } else {
          addLog("status", `✓ Pushed ${data.pushed?.length || 'all'} file(s) to branch: ${prDetails.branch}`);
        }
      } else {
        const prTitle = prompt.split('\n')[0].slice(0, 72);
        const filesChanged = modifications.map(m => `- \`${m.path}\``).join('\n');
        const prBody = `### Task\n${prompt}\n\n### Summary\n${summary || 'No summary generated.'}\n\n### Files Changed\n${filesChanged}`;
        const res = await fetch("/api/github/pr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: repoContext.owner, repo: repoContext.repo,
            defaultBranch: repoContext.defaultBranch, modifications,
            title: prTitle, description: prBody,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to submit PR");
        setPrUrl(data.url);
        setPrBranch(data.branch || "");
      }
      setReviewFeedback("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderDiff = (mod: { path: string; originalContent: string; content: string }) => {
    const patch = Diff.createTwoFilesPatch(
      mod.path, mod.path,
      mod.originalContent || "", mod.content || "",
      "Original", "Modified"
    );
    const html = Diff2Html.html(patch, {
      drawFileList: false,
      matching: "lines",
      outputFormat: "line-by-line",
      colorScheme: "dark" as any,
    });
    return <div dangerouslySetInnerHTML={{ __html: html }} className="diff-wrapper" />;
  };

  const getLogIcon = (type: LogEntry["type"]) => {
    switch (type) {
      case "tool": return <FileIcon />;
      case "tool_done": return <span style={{ color: 'var(--success)' }}>✓</span>;
      case "tool_error":
      case "error": return <span style={{ color: 'var(--error)' }}>✗</span>;
      default: return <span style={{ color: 'var(--primary)' }}>›</span>;
    }
  };

  const getLogColor = (type: LogEntry["type"]) => {
    switch (type) {
      case "tool_done": return "var(--success)";
      case "tool_error":
      case "error": return "var(--error)";
      case "tool": return "var(--accent)";
      default: return "var(--muted)";
    }
  };

  return (
    <div className="page-workspace animate-fade-in">
      {/* ── Sidebar ── */}
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
          <span className="text-gradient" style={{ fontSize: '0.95rem' }}>PR-Creator</span>
        </button>
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h2 className="section-title" style={{ marginBottom: '0.25rem' }}>
                <CodeIcon />
                {repoContext.owner}/{repoContext.repo}
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{repoContext.description || "No description"}</p>
            </div>
            <button onClick={onReset} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px' }}>
              <XIcon />
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span className="badge">{repoContext.defaultBranch}</span>
            <span className="badge">{repoContext.files.length} files</span>
          </div>
        </div>

        {/* Issues */}
        <div className="glass-panel" style={{ padding: '1.25rem', flex: 1, maxHeight: '400px', overflowY: 'auto' }}>
          <h3 className="section-title">
            <AlertIcon />
            Open Issues ({repoContext.issues.length})
          </h3>
          {repoContext.issues.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No open issues found.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {repoContext.issues.map((issue) => (
                <div
                  key={issue.number}
                  className="issue-card"
                  onClick={() => setPrompt(`Fix Issue #${issue.number}: ${issue.title}\n\n${issue.body || ""}`)}
                >
                  <div className="issue-number">#{issue.number}</div>
                  <div className="issue-title">{issue.title}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Repo Explanation */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <h3 className="section-title" style={{ marginBottom: 0 }}>Repo Overview</h3>
            <button
              onClick={handleExplainRepo}
              disabled={isExplaining}
              className="btn-primary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', gap: '0.35rem' }}
            >
              {isExplaining ? (
                <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              )}
              Explain
            </button>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Uses: {modelId}</p>
          {isExplaining ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
              Analyzing repository...
            </div>
          ) : repoExplanation ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{repoExplanation}</div>
          ) : (
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Click "Explain" to analyze this repository.</p>
          )}
        </div>

        {/* Usage widget — always visible */}
        <div className="glass-panel usage-widget animate-fade-in">
          <h3 className="section-title">
            <ActivityIcon />
            Usage
            {usage && <span className="usage-provider-tag">{usage.provider}</span>}
          </h3>
          <div className="usage-row"><span className="label">Input Tokens</span><span>{(usage?.inputTokens ?? 0).toLocaleString()}</span></div>
          <div className="usage-row"><span className="label">Output Tokens</span><span>{(usage?.outputTokens ?? 0).toLocaleString()}</span></div>
          <div className="usage-divider" />
          <div className="usage-total"><span>Est. Cost</span><span>${(usage?.estimatedCostUsd ?? 0).toFixed(4)}</span></div>
        </div>
      </div>

      {/* ── Main Area ── */}
      <div className="main-area">
        {/* Prompt */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <form onSubmit={handleRunAgent} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <label style={{ fontSize: '1.1rem', fontWeight: 700 }}>What would you like to build or fix?</label>
              <div className="model-selector">
                <CpuIcon />
                <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  <option value="claude-opus-4-6">Claude Opus 4.6 (Premium)</option>
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4 (Fast)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fastest)</option>
                </select>
              </div>
            </div>

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., Fix the navigation bar responsiveness, or implement the login page styling."
              className="prompt-area"
              required
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              {isAgentRunning && (
                <button type="button" onClick={handleStop} className="btn-stop">
                  <XIcon />
                  Stop
                </button>
              )}
              <button type="submit" disabled={isAgentRunning || !prompt} className="btn-primary">
                {isAgentRunning ? (
                  <>
                    <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                    Running...
                  </>
                ) : (
                  <>
                    <PlayIcon />
                    Run AI Engineer
                  </>
                )}
              </button>
            </div>

            {error && <div className="error-text">{error}</div>}
          </form>
        </div>

        {/* PR Review Panel — shown when working on an active PR */}
        {activePR && (
          <div className="glass-panel animate-fade-in" style={{ padding: '1.25rem' }}>
            <h3 className="section-title" style={{ marginBottom: '0.75rem' }}>
              <GitPRIcon />
              PR #{activePR.number}: {activePR.title}
              <a href={activePR.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 'auto' }}>↗ GitHub</a>
            </h3>

            {loadingPRDetails ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
                Loading PR details...
              </div>
            ) : prDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Reviews (approvals, changes requested) */}
                {prDetails.reviews?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reviews</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      {prDetails.reviews.map((r: any) => (
                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', padding: '0.35rem 0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                          <span style={{ color: r.state === 'APPROVED' ? 'var(--success)' : r.state === 'CHANGES_REQUESTED' ? 'var(--error)' : 'var(--muted)', fontWeight: 600, fontSize: '0.7rem' }}>
                            {r.state === 'APPROVED' ? '✓ APPROVED' : r.state === 'CHANGES_REQUESTED' ? '✗ CHANGES REQUESTED' : r.state}
                          </span>
                          <span style={{ color: 'var(--muted)' }}>by {r.user}</span>
                          {r.body && <span style={{ color: 'var(--foreground)', marginLeft: '0.25rem' }}>— {r.body.slice(0, 100)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Check Runs (CI/CD results) */}
                {prDetails.checkRuns?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CI / Checks</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {prDetails.checkRuns.map((check: any, i: number) => {
                        const isFailing = check.conclusion === 'failure';
                        const hasDetails = isFailing && (check.annotations?.length > 0 || check.logs);
                        return (
                          <div key={i} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                            <div
                              style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', cursor: 'pointer',
                                borderLeft: `3px solid ${check.conclusion === 'success' ? 'var(--success)' : isFailing ? 'var(--error)' : 'var(--muted)'}`,
                              }}
                              onClick={() => {
                                if (hasDetails) {
                                  const el = document.getElementById(`check-${i}`);
                                  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                                } else if (check.url) {
                                  window.open(check.url, '_blank');
                                }
                              }}
                            >
                              <span style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ color: check.conclusion === 'success' ? 'var(--success)' : isFailing ? 'var(--error)' : 'var(--muted)' }}>
                                  {check.conclusion === 'success' ? '✓' : isFailing ? '✗' : '○'}
                                </span>
                                {check.name}
                                {hasDetails && <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>▼ expand</span>}
                              </span>
                              {isFailing && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const annotationText = check.annotations?.map((a: any) => `${a.path}:${a.startLine} — ${a.message}`).join('\n') || '';
                                    const logSnippet = check.logs?.slice(-1500) || '';
                                    setPrompt(`Fix failing CI check "${check.name}":\n\n${annotationText ? `Annotations:\n${annotationText}\n\n` : ''}${logSnippet ? `Test Logs (last 1500 chars):\n${logSnippet}` : check.output || 'No output available'}`);
                                  }}
                                  className="btn-primary"
                                  style={{ fontSize: '0.65rem', padding: '2px 8px', gap: '0.25rem' }}
                                >
                                  Fix with AI →
                                </button>
                              )}
                            </div>
                            {hasDetails && (
                              <div id={`check-${i}`} style={{ display: 'none', padding: '0.5rem 0.6rem', borderTop: '1px solid var(--surface-border)' }}>
                                {check.annotations?.length > 0 && (
                                  <div style={{ marginBottom: '0.5rem' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--error)', marginBottom: '0.25rem' }}>Annotations ({check.annotations.length})</div>
                                    {check.annotations.map((a: any, j: number) => (
                                      <div key={j} style={{ fontSize: '0.75rem', padding: '0.3rem', background: 'rgba(239,68,68,0.06)', borderRadius: '4px', marginBottom: '0.2rem' }}>
                                        <code style={{ fontSize: '0.7rem', color: 'var(--primary)' }}>{a.path}:{a.startLine}</code>
                                        {a.title && <span style={{ color: 'var(--error)', fontWeight: 600, marginLeft: '0.5rem' }}>{a.title}</span>}
                                        <div style={{ color: 'var(--foreground)', marginTop: '2px' }}>{a.message}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {check.logs && (
                                  <div>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.25rem' }}>Logs (last 3000 chars)</div>
                                    <pre style={{
                                      fontSize: '0.68rem', color: 'var(--foreground)', background: 'rgba(0,0,0,0.4)',
                                      padding: '0.5rem', borderRadius: '4px', maxHeight: '300px', overflowY: 'auto',
                                      whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.4,
                                      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                                    }}>
                                      {check.logs}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Review Comments (inline code comments) */}
                {prDetails.reviewComments?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Code Review Comments ({prDetails.reviewComments.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '250px', overflowY: 'auto' }}>
                      {prDetails.reviewComments.map((c: any) => (
                        <div
                          key={c.id}
                          onClick={() => setPrompt(`Fix review comment by ${c.user} on ${c.path}${c.line ? `:${c.line}` : ''}:\n\n"${c.body}"`)}
                          style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid transparent', transition: 'border-color 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
                          onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>
                            <span><strong>{c.user}</strong> on <code style={{ fontSize: '0.7rem' }}>{c.path}{c.line ? `:${c.line}` : ''}</code></span>
                            <span style={{ fontSize: '0.6rem' }}>click to fix →</span>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--foreground)', lineHeight: 1.5 }}>{c.body.slice(0, 200)}{c.body.length > 200 ? '...' : ''}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Issue Comments (general conversation) */}
                {prDetails.issueComments?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Comments ({prDetails.issueComments.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {prDetails.issueComments.map((c: any) => (
                        <div key={c.id} style={{ padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.2rem' }}>
                            <strong>{c.user}</strong> • {new Date(c.createdAt).toLocaleDateString()}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--foreground)', lineHeight: 1.5 }}>{c.body.slice(0, 300)}{c.body.length > 300 ? '...' : ''}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Post Comment */}
                <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                  <input
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    placeholder="Write a comment on this PR..."
                    className="input-base"
                    style={{ flex: 1, fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); }}}
                  />
                  <button
                    onClick={() => handlePostComment()}
                    disabled={postingComment || !commentText.trim()}
                    className="btn-primary"
                    style={{ fontSize: '0.8rem', padding: '0.5rem 1rem' }}
                  >
                    {postingComment ? <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Comment'}
                  </button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No PR details available.</p>
            )}
          </div>
        )}

        {/* Live Activity Log */}
        {(isAgentRunning || logs.length > 0) && !modifications && (
          <div className="glass-panel animate-fade-in" style={{ padding: '1.25rem' }}>
            <h3 className="section-title" style={{ marginBottom: '0.75rem' }}>
              <TerminalIcon />
              Agent Activity
              {isAgentRunning && <span className="usage-provider-tag" style={{ background: 'rgba(52,211,153,0.15)', color: 'var(--success)' }}>LIVE</span>}
            </h3>
            <div style={{
              background: 'rgba(0,0,0,0.5)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--surface-border)',
              padding: '0.75rem',
              maxHeight: '300px',
              overflowY: 'auto',
              fontFamily: "'SF Mono', 'Menlo', monospace",
              fontSize: '0.8rem',
              lineHeight: '1.8',
            }}>
              {logs.map((log) => (
                <div key={log.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', color: getLogColor(log.type) }}>
                  <span style={{ flexShrink: 0, width: '16px', textAlign: 'center' }}>{getLogIcon(log.type)}</span>
                  <span style={{ color: 'var(--muted)', flexShrink: 0, fontSize: '0.7rem', marginTop: '2px' }}>
                    {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span>{log.message}</span>
                </div>
              ))}
              {isAgentRunning && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--primary)' }}>
                  <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                  <span style={{ opacity: 0.6 }}>Waiting for agent...</span>
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* PR Success + Review Iteration */}
        {prUrl && (
          <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem' }}>
            <div className="pr-banner">
              <div className="pr-banner-icon"><CheckIcon /></div>
              <h3>Pull Request Submitted!</h3>
              <a href={prUrl} target="_blank" rel="noreferrer">{prUrl}</a>
            </div>
            <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.95rem' }}>Got review feedback? Paste it here to iterate:</label>
              <textarea
                value={reviewFeedback}
                onChange={(e) => setReviewFeedback(e.target.value)}
                placeholder="Paste PR review comments, CI test logs, or describe what needs to change..."
                className="prompt-area"
                style={{ minHeight: '80px' }}
              />
              <button
                onClick={handleRunAgent}
                disabled={isAgentRunning || !reviewFeedback}
                className="btn-primary"
                style={{ alignSelf: 'flex-end' }}
              >
                <PlayIcon />
                Re-run Agent with Feedback
              </button>
            </div>
          </div>
        )}

        {/* Diffs */}
        {modifications && !prUrl && (
          <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Agent Summary */}
            {summary && (
              <div className="glass-panel" style={{ padding: '1.25rem', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                <h3 className="section-title" style={{ marginBottom: '0.5rem' }}>Agent Summary</h3>
                <div style={{ fontSize: '0.9rem', color: 'var(--foreground)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{summary}</div>
              </div>
            )}

            <div className="merge-bar">
              <div>
                <h3>Ready to Merge</h3>
                <p>{modifications.length} file{modifications.length > 1 ? 's' : ''} modified</p>
              </div>
              <button onClick={handleSubmitPR} disabled={isSubmitting} className="btn-success">
                {isSubmitting ? (
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: 'var(--background)' }} />
                ) : (
                  <>
                    <GitPRIcon />
                    Submit Pull Request
                  </>
                )}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {modifications.map((mod, idx) => (
                <div key={idx} className="glass-panel" style={{ overflow: 'hidden', padding: 0 }}>
                  <div className="diff-file-header">{mod.path}</div>
                  <div style={{ padding: '0.75rem', overflowX: 'auto' }}>{renderDiff(mod)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
