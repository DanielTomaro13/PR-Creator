"use client";

import { useState } from "react";
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

export function Workspace({ repoContext, onReset }: { repoContext: RepoContext; onReset: () => void }) {
  const [modelId, setModelId] = useState("claude-opus-4-6");
  const [prompt, setPrompt] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentStep, setAgentStep] = useState("");
  const [modifications, setModifications] = useState<{ path: string; originalContent: string; content: string }[] | null>(null);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;
    setIsAgentRunning(true);
    setModifications(null);
    setUsage(null);
    setError("");
    setAgentStep("Analyzing codebase & drafting changes...");

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
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Agent failed");

      setModifications(data.modifications);
      setUsage(data.usage);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAgentRunning(false);
      setAgentStep("");
    }
  };

  const handleSubmitPR = async () => {
    if (!modifications) return;
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repoContext.owner,
          repo: repoContext.repo,
          defaultBranch: repoContext.defaultBranch,
          modifications,
          title: prompt.split('\n')[0].slice(0, 50),
          description: `This PR was automatically generated by PR-Creator AI.\n\n### Task\n${prompt}`,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit PR");

      setPrUrl(data.url);
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
        <div className="glass-panel" style={{ padding: '1.25rem', flex: 1, maxHeight: '500px', overflowY: 'auto' }}>
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

        {/* Usage widget */}
        {usage && (
          <div className="glass-panel usage-widget animate-fade-in">
            <h3 className="section-title">
              <ActivityIcon />
              Run Metrics
              <span className="usage-provider-tag">{usage.provider}</span>
            </h3>
            <div className="usage-row"><span className="label">Input Tokens</span><span>{usage.inputTokens.toLocaleString()}</span></div>
            <div className="usage-row"><span className="label">Output Tokens</span><span>{usage.outputTokens.toLocaleString()}</span></div>
            <div className="usage-divider" />
            <div className="usage-total"><span>Est. Cost</span><span>${usage.estimatedCostUsd.toFixed(4)}</span></div>
          </div>
        )}
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
                  <option value="claude-3-7-sonnet-20250219">Claude 3.7 Sonnet (Fast)</option>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={isAgentRunning || !prompt} className="btn-primary">
                {isAgentRunning ? (
                  <>
                    <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                    {agentStep}
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

        {/* PR Success */}
        {prUrl && (
          <div className="pr-banner animate-fade-in">
            <div className="pr-banner-icon"><CheckIcon /></div>
            <h3>Pull Request Submitted!</h3>
            <a href={prUrl} target="_blank" rel="noreferrer">{prUrl}</a>
          </div>
        )}

        {/* Diffs */}
        {modifications && !prUrl && (
          <div className="glass-panel animate-fade-in" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
