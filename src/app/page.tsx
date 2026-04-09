"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { Workspace, RepoContext } from "../components/Workspace";
import { ReviewWorkspace } from "../components/ReviewWorkspace";

const GithubIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const ArrowIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
);

const LogOutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const ClockIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

interface PREntry {
  id: number;
  number: number;
  title: string;
  repo: string;
  state: string;
  url: string;
  createdAt: string;
}

interface SavedSession {
  id: string;
  repo: string;
  prompt: string;
  modelId: string;
  status: string;
  timestamp: string;
  usage?: { estimatedCostUsd: number; inputTokens: number; outputTokens: number };
  modifications?: any[];
  summary?: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [repoUrl, setRepoUrl] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [repoContext, setRepoContext] = useState<RepoContext | null>(null);
  const [error, setError] = useState("");
  const [prHistory, setPrHistory] = useState<PREntry[]>([]);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [loadingPRs, setLoadingPRs] = useState(false);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [activePR, setActivePR] = useState<{ url: string; title: string; number: number; owner: string; repo: string } | null>(null);
  const [loadingPR, setLoadingPR] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<any[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [reviewPR, setReviewPR] = useState<{ url: string; owner: string; repo: string; number: number; title: string } | null>(null);

  // Load saved sessions from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pr-creator-sessions');
      if (raw) {
        const sessions = Object.values(JSON.parse(raw)) as SavedSession[];
        setSavedSessions(sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10));
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch PR history when authenticated
  useEffect(() => {
    if (session?.accessToken) {
      setLoadingPRs(true);
      fetch("/api/github/prs")
        .then(r => r.json())
        .then(data => { if (data.prs) setPrHistory(data.prs); })
        .catch(() => {})
        .finally(() => setLoadingPRs(false));
    }
  }, [session]);

  // Fetch provider status when authenticated
  useEffect(() => {
    if (session?.accessToken) {
      setLoadingProviders(true);
      fetch("/api/provider-status")
        .then(r => r.json())
        .then(data => { if (data.providers) setProviderStatus(data.providers); })
        .catch(() => {})
        .finally(() => setLoadingProviders(false));
    }
  }, [session]);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    setIsIngesting(true);
    setError("");

    // Detect PR URL: https://github.com/owner/repo/pull/123
    const prMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (prMatch) {
      const [, prOwner, prRepo, prNum] = prMatch;
      setReviewPR({ url: repoUrl, owner: prOwner, repo: prRepo, number: parseInt(prNum), title: `PR #${prNum}` });
      setIsIngesting(false);
      return;
    }

    try {
      const res = await fetch("/api/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to ingest repository");

      setRepoContext(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleOpenPR = async (pr: PREntry) => {
    if (pr.state !== 'open') {
      window.open(pr.url, '_blank');
      return;
    }
    setLoadingPR(pr.url);
    setError("");
    try {
      const repoUrl = `https://github.com/${pr.repo}`;
      const res = await fetch("/api/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load repository");
      const [prOwner, prRepo] = pr.repo.split('/');
      setActivePR({ url: pr.url, title: pr.title, number: pr.number, owner: prOwner, repo: prRepo });
      setRepoContext(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingPR(null);
    }
  };

  const clearSessions = () => {
    localStorage.removeItem('pr-creator-sessions');
    sessionStorage.removeItem('pr-creator-session-id');
    setSavedSessions([]);
  };

  const getStatusBadge = (state: string) => {
    const styles: Record<string, { bg: string; color: string; label: string }> = {
      open: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', label: 'Open' },
      merged: { bg: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', label: 'Merged' },
      closed: { bg: 'rgba(107, 114, 128, 0.15)', color: '#9ca3af', label: 'Closed' },
    };
    const s = styles[state] || styles.closed;
    return <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', background: s.bg, color: s.color, fontWeight: 600 }}>{s.label}</span>;
  };

  const getSessionStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      complete: { bg: 'rgba(52, 211, 153, 0.15)', color: 'var(--success)' },
      failed: { bg: 'rgba(239, 68, 68, 0.15)', color: 'var(--error)' },
      running: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' },
      idle: { bg: 'rgba(107, 114, 128, 0.15)', color: '#9ca3af' },
    };
    const s = styles[status] || styles.idle;
    return <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '999px', background: s.bg, color: s.color, fontWeight: 600, textTransform: 'capitalize' as const }}>{status}</span>;
  };

  if (status === "loading") {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    );
  }

  if (reviewPR) {
    return <ReviewWorkspace reviewPR={reviewPR} onReset={() => setReviewPR(null)} />;
  }

  if (repoContext) {
    return <Workspace repoContext={repoContext} onReset={() => { setRepoContext(null); setActivePR(null); }} activePR={activePR} />;
  }

  return (
    <main className="page-center">
      {/* Background orbs */}
      <div className="orb orb-primary" />
      <div className="orb orb-accent" />
      <div className="orb orb-small" />

      {/* User chip */}
      {session && (
        <div className="user-chip glass animate-fade-in">
          {session.user?.image && <img src={session.user.image} alt="Avatar" />}
          <span>{session.user?.name}</span>
          <a href={`https://github.com/${session.user?.name}`} target="_blank" rel="noreferrer" title="View GitHub Profile" style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
            <ExternalLinkIcon />
          </a>
          <button onClick={() => signOut()} title="Sign Out">
            <LogOutIcon />
          </button>
        </div>
      )}

      {/* Hero content */}
      <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: '700px' }}>
        <div className="logo-badge animate-fade-in animate-float">
          <GithubIcon />
        </div>

        <h1 className="hero-title animate-fade-in-delay">
          <span className="text-gradient">PR-Creator</span>
        </h1>

        <p className="hero-subtitle animate-fade-in-delay-2">
          Your autonomous AI software engineer. Connect your repository, give an instruction, and review ready-to-merge Pull Requests — in seconds.
        </p>

        {status === "unauthenticated" ? (
          <button onClick={() => signIn("github")} className="btn-primary animate-fade-in-delay-2" style={{ fontSize: '1.05rem', padding: '1rem 2.5rem' }}>
            <GithubIcon />
            Connect GitHub to Start
          </button>
        ) : (
          <div className="animate-fade-in-delay-2" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
            <form onSubmit={handleIngest} style={{ width: '100%', maxWidth: '540px' }}>
              <div className="input-wrapper">
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo or .../pull/123"
                  className="input-base"
                  style={{ fontSize: '1.05rem', padding: '1rem 4rem 1rem 1.25rem' }}
                  required
                />
                <button type="submit" disabled={isIngesting || !repoUrl} className="input-action-btn">
                  {isIngesting ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : <ArrowIcon />}
                </button>
              </div>
              {error && <div className="error-text" style={{ marginTop: '0.75rem' }}>{error}</div>}
            </form>

            {/* Provider Status */}
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '640px', padding: '1.25rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                API Status
              </h3>
              {loadingProviders ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.82rem' }}>
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
                  Checking provider availability...
                </div>
              ) : providerStatus.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {providerStatus.map((p: any) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${p.status === 'available' ? 'var(--success)' : p.status === 'no_key' ? 'var(--muted)' : 'var(--error)'}` }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '1px' }}>{p.message}</div>
                      </div>
                      <span style={{
                        fontSize: '0.65rem', padding: '2px 8px', borderRadius: '999px', fontWeight: 600,
                        background: p.status === 'available' ? 'rgba(52,211,153,0.15)' : p.status === 'no_key' ? 'rgba(107,114,128,0.15)' : 'rgba(239,68,68,0.15)',
                        color: p.status === 'available' ? 'var(--success)' : p.status === 'no_key' ? 'var(--muted)' : 'var(--error)',
                      }}>
                        {p.status === 'available' ? '● READY' : p.status === 'no_key' ? '○ NO KEY' : '● EXHAUSTED'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No provider info available.</p>
              )}
            </div>

            {/* Session History */}
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '640px', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ClockIcon /> Recent Sessions
                </h3>
                {savedSessions.length > 0 && (
                  <button onClick={clearSessions} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}>
                    <TrashIcon /> Clear
                  </button>
                )}
              </div>
              {savedSessions.length === 0 ? (
                <p style={{ fontSize: '0.82rem', color: 'var(--muted)', textAlign: 'center', padding: '0.5rem 0' }}>No sessions yet. Load a repo and run the AI engineer to get started.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {savedSessions.slice(0, 5).map((s) => (
                    <div
                      key={s.id}
                      className="session-card"
                      style={{ cursor: 'pointer' }}
                      onClick={async () => {
                        setError("");
                        setIsIngesting(true);
                        try {
                          const repoUrl = `https://github.com/${s.repo}`;
                          const res = await fetch("/api/github/scan", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ repoUrl }),
                          });
                          const data = await res.json();
                          if (!res.ok) throw new Error(data.error || "Failed to load repo");
                          setRepoContext(data);
                        } catch (err: any) {
                          setError(err.message);
                        } finally {
                          setIsIngesting(false);
                        }
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{s.repo}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          {getSessionStatusBadge(s.status)}
                          <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>→ load</span>
                        </div>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '2px' }}>
                        {s.prompt?.slice(0, 80)}{s.prompt?.length > 80 ? '...' : ''}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--muted)', marginTop: '4px' }}>
                        <span>{s.modelId}</span>
                        <span>{s.usage ? `$${s.usage.estimatedCostUsd.toFixed(4)}` : ''} • {new Date(s.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Open PRs — grouped by repo */}
            <div className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '640px', padding: '1.25rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <GithubIcon className="" /> Open PRs
              </h3>
              {loadingPRs ? (
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2, margin: '0 auto' }} />
                  <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.5rem' }}>Loading PR history...</p>
                </div>
              ) : prHistory.filter(p => p.state === 'open').length === 0 ? (
                <p style={{ fontSize: '0.82rem', color: 'var(--muted)', textAlign: 'center', padding: '0.5rem 0' }}>No open PRs. All clear!</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(() => {
                    const openPRs = prHistory.filter(p => p.state === 'open');
                    const grouped: Record<string, PREntry[]> = {};
                    openPRs.forEach(pr => {
                      if (!grouped[pr.repo]) grouped[pr.repo] = [];
                      grouped[pr.repo].push(pr);
                    });
                    return Object.entries(grouped).map(([repoName, prs]) => {
                      const isExpanded = expandedRepos.has(repoName);
                      return (
                        <div key={repoName}>
                          <button
                            onClick={() => {
                              setExpandedRepos(prev => {
                                const next = new Set(prev);
                                if (next.has(repoName)) next.delete(repoName);
                                else next.add(repoName);
                                return next;
                              });
                            }}
                            className="repo-group-header"
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}><polyline points="9 18 15 12 9 6" /></svg>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{repoName}</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>({prs.length} open)</span>
                            </div>
                          </button>
                          {isExpanded && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginTop: '0.35rem', paddingLeft: '1.25rem' }}>
                              {prs.map(pr => (
                                <div
                                  key={pr.id}
                                  onClick={() => handleOpenPR(pr)}
                                  className="pr-history-card"
                                  style={{ padding: '0.5rem 0.75rem', cursor: 'pointer' }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 500, fontSize: '0.8rem' }}>#{pr.number} {pr.title}</span>
                                    {loadingPR === pr.url ? (
                                      <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                                    ) : (
                                      <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>→ workspace</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px' }}>{new Date(pr.createdAt).toLocaleDateString()}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
