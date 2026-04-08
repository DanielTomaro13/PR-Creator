"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { Workspace, RepoContext } from "../components/Workspace";

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

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

export default function Home() {
  const { data: session, status } = useSession();
  const [repoUrl, setRepoUrl] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [repoContext, setRepoContext] = useState<RepoContext | null>(null);
  const [error, setError] = useState("");

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    setIsIngesting(true);
    setError("");

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

  if (status === "loading") {
    return (
      <div className="page-center">
        <div className="spinner" />
      </div>
    );
  }

  if (repoContext) {
    return <Workspace repoContext={repoContext} onReset={() => setRepoContext(null)} />;
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
          <button onClick={() => signOut()} title="Sign Out">
            <LogOutIcon />
          </button>
        </div>
      )}

      {/* Hero content */}
      <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
          <div className="animate-fade-in-delay-2" style={{ width: '100%', maxWidth: '540px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <form onSubmit={handleIngest} style={{ width: '100%' }}>
              <div className="input-wrapper">
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/username/repository"
                  className="input-base"
                  style={{ fontSize: '1.05rem', padding: '1rem 4rem 1rem 1.25rem' }}
                  required
                />
                <button type="submit" disabled={isIngesting || !repoUrl} className="input-action-btn">
                  {isIngesting ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : <ArrowIcon />}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
