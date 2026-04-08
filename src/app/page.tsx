"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { ArrowRight, Loader2, LogOut, Settings } from "lucide-react";
import { Workspace, RepoContext } from "../components/Workspace";

const GithubIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
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
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (repoContext) {
    return <Workspace repoContext={repoContext} onReset={() => setRepoContext(null)} />;
  }

  return (
    <main className="min-h-screen p-8 md:p-24 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background glowing orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary rounded-full mix-blend-screen filter blur-[128px] opacity-20 animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent rounded-full mix-blend-screen filter blur-[128px] opacity-20 animate-pulse" style={{ animationDelay: '2s' }}></div>

      {session ? (
        <div className="absolute top-6 right-6 flex items-center gap-4 animate-fade-in glass-panel px-4 py-2 z-20">
          {session.user?.image && <img src={session.user.image} alt="Avatar" className="w-8 h-8 rounded-full border border-surface-border" />}
          <span className="text-sm font-medium">{session.user?.name}</span>
          <button onClick={() => signOut()} className="text-muted hover:text-foreground transition-colors ml-2" title="Sign Out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      ) : null}

      <div className="z-10 w-full max-w-3xl flex flex-col items-center text-center animate-fade-in">
        <div className="inline-flex items-center justify-center p-5 rounded-3xl glass mb-8">
          <GithubIcon className="w-12 h-12 text-foreground" />
        </div>
        
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
          <span className="text-gradient">PR-Creator</span>
        </h1>
        <p className="text-xl text-muted mb-12 max-w-2xl leading-relaxed">
          Your autonomous AI software engineer. Connect your repository, give an instruction, and review ready-to-merge Pull Requests in seconds.
        </p>

        {status === "unauthenticated" ? (
          <button 
            onClick={() => signIn("github")}
            className="btn-primary text-lg px-8 py-4 rounded-xl"
            style={{ fontSize: '1.125rem' }}
          >
            <GithubIcon className="w-6 h-6 mr-2" />
            Connect GitHub to Start
          </button>
        ) : (
          <form onSubmit={handleIngest} className="w-full max-w-xl flex flex-col gap-4 animate-fade-in">
            <div className="relative group">
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/username/repository"
                className="input-base text-lg py-4 pl-6 pr-20 rounded-xl bg-surface border-surface-border focus:border-primary w-full shadow-2xl"
                required
              />
              <button 
                type="submit"
                disabled={isIngesting || !repoUrl}
                className="btn-primary absolute right-2 top-2 bottom-2 rounded-lg"
              >
                {isIngesting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              </button>
            </div>
            {error && <div className="text-error mt-2">{error}</div>}
            <p className="text-sm text-muted text-left flex items-center justify-center gap-2 mt-4 glass px-4 py-2 rounded-lg">
               <Settings className="w-4 h-4" /> To use the agent, add your Anthropic API Key to <code className="bg-background border border-surface-border rounded px-1.5 py-0.5 text-xs text-primary font-mono">.env.local</code>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
