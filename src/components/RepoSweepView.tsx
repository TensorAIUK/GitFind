import React, { useRef, useState } from 'react';
import {
  FolderSearch,
  Play,
  Square,
  ExternalLink,
  Eye,
  Radar,
  Lock,
  Globe,
  CheckCircle2,
} from 'lucide-react';
import { GitHubRepo } from '../types/github';
import { getRepoTree, listUserRepos } from '../services/githubApi';

interface RepoSweepViewProps {
  token: string;
  onSelectRepoToScan: (owner: string, repo: string) => void;
  onPreviewFile: (target: {
    owner: string;
    repo: string;
    path: string;
    branch: string;
  }) => void;
}

interface SweepMatch {
  repo: GitHubRepo;
  path: string;
  size: number;
}

const SWEEP_PRESETS = [
  { label: '.env files', pattern: '.env', mode: 'name' as const },
  { label: 'Private keys (.pem/.key)', pattern: 'pem,key,p12', mode: 'ext' as const },
  { label: 'Dockerfile', pattern: 'Dockerfile', mode: 'name' as const },
  { label: 'Terraform (.tf)', pattern: 'tf', mode: 'ext' as const },
  { label: 'GitHub Workflows', pattern: '.github/workflows', mode: 'path' as const },
  { label: 'package.json', pattern: 'package.json', mode: 'name' as const },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const RepoSweepView: React.FC<RepoSweepViewProps> = ({
  token,
  onSelectRepoToScan,
  onPreviewFile,
}) => {
  const [matchMode, setMatchMode] = useState<'name' | 'ext' | 'path'>('name');
  const [pattern, setPattern] = useState('.env');
  const [includeForks, setIncludeForks] = useState(false);
  const [maxRepos, setMaxRepos] = useState(50);

  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [matches, setMatches] = useState<SweepMatch[]>([]);
  const [reposScanned, setReposScanned] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const matchesItem = (filePath: string, rawPattern: string, mode: 'name' | 'ext' | 'path'): boolean => {
    const tokens = rawPattern
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) return false;

    const lowerPath = filePath.toLowerCase();
    const fileName = lowerPath.split('/').pop() ?? lowerPath;

    if (mode === 'name') {
      return tokens.some((tok) => fileName === tok || fileName.includes(tok));
    }
    if (mode === 'ext') {
      return tokens.some((tok) => {
        const clean = tok.startsWith('.') ? tok : `.${tok}`;
        return fileName.endsWith(clean);
      });
    }
    return tokens.some((tok) => lowerPath.includes(tok));
  };

  const handleRunSweep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) {
      setError('Enter a file name, extension, or path pattern.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setError(null);
    setMatches([]);
    setReposScanned(null);
    setStatusText('Loading your repositories...');

    try {
      const repos = await listUserRepos(token, 1, Math.min(100, maxRepos), controller.signal);
      const filtered = includeForks ? repos : repos.filter((r) => !r.fork);
      const targets = filtered.slice(0, maxRepos);

      setProgress({ done: 0, total: targets.length });
      const found: SweepMatch[] = [];
      let done = 0;

      const BATCH = 5;
      for (let i = 0; i < targets.length; i += BATCH) {
        if (controller.signal.aborted) break;
        const batch = targets.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (repo) => {
            if (controller.signal.aborted) return;
            try {
              setStatusText(`Checking ${repo.full_name}...`);
              const { tree } = await getRepoTree(
                token,
                repo.owner.login,
                repo.name,
                repo.default_branch,
                controller.signal
              );
              for (const item of tree) {
                if (item.type === 'blob' && matchesItem(item.path, pattern, matchMode)) {
                  found.push({
                    repo,
                    path: item.path,
                    size: item.size ?? 0,
                  });
                }
              }
            } catch (err) {
              if ((err as Error).name === 'AbortError') throw err;
              // Skip empty repos or inaccessible branches
            } finally {
              done++;
              setProgress({ done, total: targets.length });
              setMatches([...found]);
            }
          })
        );
      }

      setReposScanned(done);
      setStatusText('');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Sweep failed');
      }
    } finally {
      setRunning(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
    setStatusText('Stopped');
  };

  return (
    <div className="search-view">
      <section className="panel">
        <div className="panel-header-inline">
          <div>
            <h2>
              <FolderSearch size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Sweep All My Repositories
            </h2>
            <p className="muted-text">
              Check live git trees across all your public &amp; private repos for a specific file name, extension, or path.
            </p>
          </div>
        </div>

        <div className="preset-row">
          <span className="preset-label">Presets:</span>
          {SWEEP_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="preset-chip"
              onClick={() => {
                setPattern(p.pattern);
                setMatchMode(p.mode);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleRunSweep} className="search-form">
          <div className="sweep-inputs-row">
            <select
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as 'name' | 'ext' | 'path')}
              aria-label="Match type"
            >
              <option value="name">File name</option>
              <option value="ext">File extension(s)</option>
              <option value="path">Path contains</option>
            </select>

            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={
                matchMode === 'ext'
                  ? 'e.g. env, pem, tf (comma-separated)'
                  : matchMode === 'name'
                    ? 'e.g. .env, Dockerfile, package.json'
                    : 'e.g. .github/workflows, config/'
              }
              style={{ flex: 1 }}
            />

            {!running ? (
              <button type="submit" className="btn btn-primary">
                <Play size={15} /> Sweep Repos
              </button>
            ) : (
              <button type="button" className="btn btn-danger" onClick={handleStop}>
                <Square size={15} /> Stop
              </button>
            )}
          </div>

          <div className="filter-row">
            <label className="checkbox-chip">
              <input
                type="checkbox"
                checked={includeForks}
                onChange={(e) => setIncludeForks(e.target.checked)}
              />
              <span>Include forked repos</span>
            </label>

            <label className="filter-item">
              <span>Max repos</span>
              <select
                value={maxRepos}
                onChange={(e) => setMaxRepos(Number(e.target.value))}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
        </form>

        {running && (
          <div className="progress-wrap" style={{ marginTop: '0.85rem' }}>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="progress-meta">
              <span>
                Checked {progress.done} / {progress.total} repositories
              </span>
              <span className="muted-text truncate">{statusText}</span>
            </div>
          </div>
        )}

        {error && <div className="error-banner" style={{ marginTop: '0.75rem' }}>{error}</div>}
      </section>

      {reposScanned !== null && (
        <section className="panel">
          <div className="results-meta" style={{ marginBottom: '0.85rem' }}>
            <span>
              Found <strong>{matches.length}</strong> matching file{matches.length === 1 ? '' : 's'} across{' '}
              <strong>{reposScanned}</strong> repositories
            </span>
          </div>

          {matches.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={28} className="ok-icon" />
              <p>No matching files found for <code>{pattern}</code>.</p>
            </div>
          ) : (
            <div className="code-results-list">
              {matches.map((m, idx) => (
                <article key={`${m.repo.id}-${m.path}-${idx}`} className="code-card">
                  <div className="code-card-header">
                    <div className="repo-title-row">
                      <span className="code-repo">{m.repo.full_name}</span>
                      <span className={`pill ${m.repo.private ? 'pill-warn' : 'pill-neutral'}`}>
                        {m.repo.private ? <Lock size={10} /> : <Globe size={10} />}
                        {m.repo.private ? 'Private' : 'Public'}
                      </span>
                      <span className="sep">/</span>
                      <a
                        href={`${m.repo.html_url}/blob/${m.repo.default_branch}/${m.path}`}
                        target="_blank"
                        rel="noreferrer"
                        className="code-path"
                      >
                        {m.path} <ExternalLink size={12} />
                      </a>
                      <span className="muted-text" style={{ fontSize: '0.76rem' }}>
                        ({formatBytes(m.size)})
                      </span>
                    </div>

                    <div className="export-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          onPreviewFile({
                            owner: m.repo.owner.login,
                            repo: m.repo.name,
                            path: m.path,
                            branch: m.repo.default_branch,
                          })
                        }
                      >
                        <Eye size={13} /> Preview
                      </button>
                      <button
                        type="button"
                        className="btn btn-accent btn-sm"
                        onClick={() => onSelectRepoToScan(m.repo.owner.login, m.repo.name)}
                      >
                        <Radar size={13} /> Scan Repo
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
