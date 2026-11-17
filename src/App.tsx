import { useEffect, useState } from 'react';
import { Radar, LogOut, KeyRound, Gauge } from 'lucide-react';
import { GitHubUser, RateLimitInfo } from './types/github';
import { setRateLimitListener, verifyToken } from './services/githubApi';
import { AuthModal } from './components/AuthModal';
import { SearchView } from './components/SearchView';
import { ScannerView } from './components/ScannerView';

const TOKEN_STORAGE_KEY = 'gitfind_github_pat';

function loadStoredToken(): string {
  return (
    localStorage.getItem(TOKEN_STORAGE_KEY) ??
    sessionStorage.getItem(TOKEN_STORAGE_KEY) ??
    ''
  );
}

export function App() {
  const [token, setToken] = useState<string>(() => loadStoredToken());
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState<boolean>(Boolean(loadStoredToken()));

  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null);

  useEffect(() => {
    setRateLimitListener((info) => setRateLimit(info));
    return () => setRateLimitListener(null);
  }, []);

  useEffect(() => {
    const initial = loadStoredToken();
    if (!initial) {
      setBootstrapping(false);
      setAuthModalOpen(true);
      return;
    }

    verifyToken(initial)
      .then((u) => {
        setUser(u);
        setToken(initial);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken('');
        setAuthModalOpen(true);
      })
      .finally(() => {
        setBootstrapping(false);
      });
  }, []);

  const handleAuthenticate = async (newToken: string, persist: boolean) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const verifiedUser = await verifyToken(newToken);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);

      if (persist) {
        localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
      } else {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, newToken);
      }

      setToken(newToken);
      setUser(verifiedUser);
      setAuthModalOpen(false);
    } catch (err) {
      setAuthError((err as Error).message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken('');
    setUser(null);
    setSelectedRepo(null);
    setRateLimit(null);
    setAuthModalOpen(true);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            className="brand-btn"
            onClick={() => setSelectedRepo(null)}
          >
            <div className="brand-logo">
              <Radar size={20} />
            </div>
            <div>
              <span className="brand-name">GitFind</span>
              <span className="brand-tag">Repo Search &amp; Scanner</span>
            </div>
          </button>

          <div className="topbar-right">
            {rateLimit && (
              <div
                className="rate-limit-pill"
                title={`Resets at ${new Date(rateLimit.reset * 1000).toLocaleTimeString()}`}
              >
                <Gauge size={14} />
                <span>
                  {rateLimit.remaining.toLocaleString()} / {rateLimit.limit.toLocaleString()} API
                </span>
              </div>
            )}

            {user ? (
              <div className="user-menu">
                <a
                  href={user.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="user-badge"
                >
                  <img src={user.avatar_url} alt={user.login} className="avatar-xs" />
                  <span>@{user.login}</span>
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAuthModalOpen(true)}
                  title="Switch Token"
                >
                  <KeyRound size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleDisconnect}
                  title="Disconnect"
                >
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setAuthModalOpen(true)}
              >
                <KeyRound size={14} /> Connect GitHub
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">
        {bootstrapping ? (
          <div className="panel loading-panel">
            <div className="spinner" />
            <p>Verifying GitHub credentials...</p>
          </div>
        ) : user && token ? (
          selectedRepo ? (
            <ScannerView
              token={token}
              owner={selectedRepo.owner}
              repoName={selectedRepo.repo}
              onBack={() => setSelectedRepo(null)}
            />
          ) : (
            <SearchView
              token={token}
              user={user}
              onSelectRepoToScan={(owner, repo) => setSelectedRepo({ owner, repo })}
            />
          )
        ) : (
          <div className="panel empty-state">
            <KeyRound size={36} className="muted-icon" />
            <h2>Connect your GitHub Personal Access Token to begin</h2>
            <p className="muted-text">
              Search public or private repositories and scan them directly in your browser.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setAuthModalOpen(true)}
            >
              Connect GitHub Credentials
            </button>
          </div>
        )}
      </main>

      <AuthModal
        isOpen={authModalOpen}
        canClose={Boolean(user)}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticate={handleAuthenticate}
        error={authError}
        loading={authLoading}
      />
    </div>
  );
}

export default App;
