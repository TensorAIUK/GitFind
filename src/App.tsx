import { useEffect, useState } from 'react';
import { Radar, LogOut, KeyRound, Gauge, UserCheck } from 'lucide-react';
import { GitHubUser, RateLimitInfo } from './types/github';
import { setRateLimitListener, verifyToken } from './services/githubApi';
import { AppUser, fetchAppSession, logoutApp } from './services/appAuth';
import { AuthModal } from './components/AuthModal';
import { AppLoginView } from './components/AppLoginView';
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
  // Step 1: App-level authentication state
  const [appBootstrapping, setAppBootstrapping] = useState(true);
  const [appConfigured, setAppConfigured] = useState(true);
  const [appUser, setAppUser] = useState<AppUser | null>(null);

  // Step 2: GitHub authentication state (only active after appUser is logged in)
  const [token, setToken] = useState<string>(() => loadStoredToken());
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [ghBootstrapping, setGhBootstrapping] = useState<boolean>(false);

  const [selectedRepo, setSelectedRepo] = useState<{ owner: string; repo: string } | null>(null);

  useEffect(() => {
    setRateLimitListener((info) => setRateLimit(info));
    return () => setRateLimitListener(null);
  }, []);

  // Check App session on mount
  useEffect(() => {
    fetchAppSession()
      .then((status) => {
        setAppConfigured(status.configured);
        if (status.authenticated && status.user) {
          setAppUser(status.user);
        }
      })
      .catch(() => {
        setAppUser(null);
      })
      .finally(() => {
        setAppBootstrapping(false);
      });
  }, []);

  // Once appUser is authenticated, verify stored GitHub PAT or prompt for one
  useEffect(() => {
    if (!appUser) return;

    const initial = loadStoredToken();
    if (!initial) {
      setGhBootstrapping(false);
      setAuthModalOpen(true);
      return;
    }

    setGhBootstrapping(true);
    verifyToken(initial)
      .then((u) => {
        setGhUser(u);
        setToken(initial);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken('');
        setAuthModalOpen(true);
      })
      .finally(() => {
        setGhBootstrapping(false);
      });
  }, [appUser]);

  const handleAuthenticateGitHub = async (newToken: string, persist: boolean) => {
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
      setGhUser(verifiedUser);
      setAuthModalOpen(false);
    } catch (err) {
      setAuthError((err as Error).message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDisconnectGitHub = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken('');
    setGhUser(null);
    setSelectedRepo(null);
    setRateLimit(null);
    setAuthModalOpen(true);
  };

  const handleAppLogout = async () => {
    await logoutApp();
    setAppUser(null);
    setGhUser(null);
    setSelectedRepo(null);
    setRateLimit(null);
    setAuthModalOpen(false);
  };

  if (appBootstrapping) {
    return (
      <div className="app-shell">
        <main className="main-content">
          <div className="panel loading-panel">
            <div className="spinner" />
            <p>Checking session...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!appUser) {
    return (
      <div className="app-shell">
        <AppLoginView
          configured={appConfigured}
          onSuccess={(user) => setAppUser(user)}
        />
      </div>
    );
  }

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

            {ghUser ? (
              <div className="user-menu">
                <a
                  href={ghUser.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="user-badge"
                  title="Connected GitHub Account"
                >
                  <img src={ghUser.avatar_url} alt={ghUser.login} className="avatar-xs" />
                  <span>@{ghUser.login}</span>
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAuthModalOpen(true)}
                  title="Switch GitHub Token"
                >
                  <KeyRound size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleDisconnectGitHub}
                  title="Disconnect GitHub"
                >
                  GH Off
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

            <div className="app-user-divider" />

            <div className="user-menu">
              <span className="pill pill-neutral" title="App Account">
                <UserCheck size={12} /> {appUser.username}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void handleAppLogout()}
                title="Sign out of GitFind"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="main-content">
        {ghBootstrapping ? (
          <div className="panel loading-panel">
            <div className="spinner" />
            <p>Verifying GitHub credentials...</p>
          </div>
        ) : ghUser && token ? (
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
              user={ghUser}
              onSelectRepoToScan={(owner, repo) => setSelectedRepo({ owner, repo })}
            />
          )
        ) : (
          <div className="panel empty-state">
            <KeyRound size={36} className="muted-icon" />
            <h2>Connect your GitHub Personal Access Token to begin</h2>
            <p className="muted-text">
              Signed in as <strong>{appUser.username}</strong>. Now connect your GitHub PAT to search and scan repositories.
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
        canClose={Boolean(ghUser)}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticate={handleAuthenticateGitHub}
        error={authError}
        loading={authLoading}
      />
    </div>
  );
}

export default App;
