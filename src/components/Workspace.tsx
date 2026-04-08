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

export function Workspace({ repoContext, onReset }: { repoContext: RepoContext; onReset: () => void }) {
  const [modelId, setModelId] = useState("claude-opus-4-6");
  const [prompt, setPrompt] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [modifications, setModifications] = useState<{ path: string; originalContent: string; content: string }[] | null>(null);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [rawResponse, setRawResponse] = useState("");
  const [prBranch, setPrBranch] = useState("");
  const [repoExplanation, setRepoExplanation] = useState("");
  const [isExplaining, setIsExplaining] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Auto-explain repo on mount
  useEffect(() => {
    setIsExplaining(true);
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
  }, [repoContext.owner, repoContext.repo]);

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

    try {
      const prTitle = prompt.split('\n')[0].slice(0, 72);
      const filesChanged = modifications.map(m => `- \`${m.path}\``).join('\n');
      const prBody = `## PR-Creator AI

### Task
${prompt}

### Summary
${summary || 'No summary generated.'}

### Files Changed
${filesChanged}

---
*This PR was automatically generated by [PR-Creator](https://github.com/DanielTomaro13/PR-Creator) AI.*`;

      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoContext.owner,
          repo: repoContext.repo,
          defaultBranch: repoContext.defaultBranch,
          modifications,
          title: `PR-Creator: ${prTitle}`,
          description: prBody,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit PR");

      setPrUrl(data.url);
      setPrBranch(data.branch || "");
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
        {/* Repo info */}
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
          <h3 className="section-title" style={{ marginBottom: '0.5rem' }}>Repo Overview</h3>
          {isExplaining ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
              Analyzing repository...
            </div>
          ) : repoExplanation ? (
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{repoExplanation}</div>
          ) : (
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No explanation available.</p>
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
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro (Free)</option>
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
