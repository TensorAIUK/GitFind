import React, { useState } from 'react';
import {
  Search,
  Star,
  GitFork,
  Lock,
  Globe,
  Radar,
  Code2,
  FolderGit2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { GitHubCodeMatch, GitHubRepo, GitHubUser } from '../types/github';
import { parseRepoInput, searchCode, searchRepositories } from '../services/githubApi';

interface SearchViewProps {
  token: string;
  user: GitHubUser;
  onSelectRepoToScan: (owner: string, repo: string) => void;
}

type SearchMode = 'repos' | 'code';
type ScopeFilter = 'all' | 'mine';

const LANGUAGES = [
  '',
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C++',
  'C#',
  'Ruby',
  'PHP',
  'Shell',
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const SearchView: React.FC<SearchViewProps> = ({
  token,
  user,
  onSelectRepoToScan,
}) => {
  const [directRepo, setDirectRepo] = useState('');
  const [directError, setDirectError] = useState<string | null>(null);

  const [mode, setMode] = useState<SearchMode>('repos');
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [minStars, setMinStars] = useState('');
  const [sort, setSort] = useState<'best-match' | 'stars' | 'forks' | 'updated'>('best-match');

  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [repoResults, setRepoResults] = useState<GitHubRepo[]>([]);
  const [codeResults, setCodeResults] = useState<GitHubCodeMatch[]>([]);

  const handleDirectScan = (e: React.FormEvent) => {
    e.preventDefault();
    setDirectError(null);
    const parsed = parseRepoInput(directRepo);
    if (!parsed) {
      setDirectError('Enter a valid "owner/repo" or GitHub repository URL.');
      return;
    }
    onSelectRepoToScan(parsed.owner, parsed.repo);
  };

  const executeSearch = async (targetPage = 1) => {
    const parts: string[] = [];
    if (query.trim()) parts.push(query.trim());
    if (scope === 'mine') parts.push(`user:${user.login}`);
    if (language) parts.push(`language:${language}`);
    if (mode === 'repos' && minStars.trim() && !Number.isNaN(Number(minStars))) {
      parts.push(`stars:>=${Number(minStars)}`);
    }

    const fullQuery = parts.join(' ').trim();
    if (!fullQuery) {
      setError('Enter a search term or select "My Repos" to list your repositories.');
      return;
    }

    setLoading(true);
    setError(null);
    setPage(targetPage);

    try {
      if (mode === 'repos') {
        const res = await searchRepositories(token, {
          query: fullQuery,
          sort,
          page: targetPage,
          perPage: 15,
        });
        setRepoResults(res.items);
        setCodeResults([]);
        setTotalCount(res.total_count);
      } else {
        const res = await searchCode(token, {
          query: fullQuery,
          page: targetPage,
          perPage: 15,
        });
        setCodeResults(res.items);
        setRepoResults([]);
        setTotalCount(res.total_count);
      }
    } catch (err) {
      setError((err as Error).message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeSearch(1);
  };

  const perPage = 15;
  const maxPages = totalCount ? Math.min(Math.ceil(totalCount / perPage), 66) : 1;

  return (
    <div className="search-view">
      {/* Direct Repo Scan Bar */}
      <section className="panel direct-scan-panel">
        <div className="panel-header-inline">
          <div>
            <h2>Quick Scan Any Repository</h2>
            <p className="muted-text">
              Jump straight to scanning by entering <code>owner/repo</code> or a GitHub URL
            </p>
          </div>
        </div>
        <form onSubmit={handleDirectScan} className="direct-scan-form">
          <input
            type="text"
            value={directRepo}
            onChange={(e) => {
              setDirectRepo(e.target.value);
              setDirectError(null);
            }}
            placeholder="e.g. facebook/react or https://github.com/owner/repo"
          />
          <button type="submit" className="btn btn-primary">
            <Radar size={16} />
            Scan Repo
            <ArrowRight size={15} />
          </button>
        </form>
        {directError && <p className="inline-error">{directError}</p>}
      </section>

      {/* Main Search Panel */}
      <section className="panel">
        <div className="search-controls-top">
          <div className="segmented-control" role="tablist" aria-label="Search type">
            <button
              type="button"
              className={mode === 'repos' ? 'active' : ''}
              onClick={() => setMode('repos')}
            >
              <FolderGit2 size={15} />
              Repositories
            </button>
            <button
              type="button"
              className={mode === 'code' ? 'active' : ''}
              onClick={() => setMode('code')}
            >
              <Code2 size={15} />
              Code
            </button>
          </div>

          <div className="segmented-control" role="group" aria-label="Search scope">
            <button
              type="button"
              className={scope === 'all' ? 'active' : ''}
              onClick={() => setScope('all')}
            >
              All GitHub
            </button>
            <button
              type="button"
              className={scope === 'mine' ? 'active' : ''}
              onClick={() => setScope('mine')}
            >
              My Repos (@{user.login})
            </button>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="search-form">
          <div className="search-input-wrap">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === 'repos'
                  ? 'Search repositories (e.g. "llm agent", "topic:cli", "org:vercel")...'
                  : 'Search code across repos (e.g. "AKIA", "dangerouslySetInnerHTML", "repo:owner/name")...'
              }
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          <div className="filter-row">
            <label className="filter-item">
              <span>Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">Any</option>
                {LANGUAGES.filter(Boolean).map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </label>

            {mode === 'repos' && (
              <>
                <label className="filter-item">
                  <span>Min Stars</span>
                  <input
                    type="number"
                    min={0}
                    value={minStars}
                    onChange={(e) => setMinStars(e.target.value)}
                    placeholder="0"
                  />
                </label>

                <label className="filter-item">
                  <span>Sort</span>
                  <select
                    value={sort}
                    onChange={(e) =>
                      setSort(e.target.value as 'best-match' | 'stars' | 'forks' | 'updated')
                    }
                  >
                    <option value="best-match">Best match</option>
                    <option value="stars">Most stars</option>
                    <option value="forks">Most forks</option>
                    <option value="updated">Recently updated</option>
                  </select>
                </label>
              </>
            )}
          </div>
        </form>

        {error && <div className="error-banner">{error}</div>}
      </section>

      {/* Results */}
      {totalCount !== null && (
        <section className="results-section">
          <div className="results-meta">
            <span>
              Found <strong>{totalCount.toLocaleString()}</strong>{' '}
              {mode === 'repos' ? 'repositories' : 'code matches'}
            </span>
            {totalCount > perPage && (
              <div className="pagination">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page <= 1 || loading}
                  onClick={() => void executeSearch(page - 1)}
                >
                  <ChevronLeft size={15} /> Prev
                </button>
                <span className="page-indicator">
                  Page {page} of {maxPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page >= maxPages || loading}
                  onClick={() => void executeSearch(page + 1)}
                >
                  Next <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>

          {mode === 'repos' && (
            <div className="repo-grid">
              {repoResults.map((repo) => (
                <article key={repo.id} className="repo-card">
                  <div className="repo-card-top">
                    <div className="repo-title-row">
                      <img
                        src={repo.owner.avatar_url}
                        alt={repo.owner.login}
                        className="avatar-xs"
                      />
                      <a
                        href={repo.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="repo-name-link"
                      >
                        {repo.full_name}
                        <ExternalLink size={13} />
                      </a>
                      <span className={`pill ${repo.private ? 'pill-warn' : 'pill-neutral'}`}>
                        {repo.private ? <Lock size={11} /> : <Globe size={11} />}
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      onClick={() => onSelectRepoToScan(repo.owner.login, repo.name)}
                    >
                      <Radar size={14} />
                      Scan
                    </button>
                  </div>

                  <p className="repo-desc">
                    {repo.description || <span className="muted-text">No description provided.</span>}
                  </p>

                  {repo.topics && repo.topics.length > 0 && (
                    <div className="topic-list">
                      {repo.topics.slice(0, 5).map((topic) => (
                        <span key={topic} className="topic-chip">
                          {topic}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="repo-stats">
                    {repo.language && <span className="stat-item">{repo.language}</span>}
                    <span className="stat-item">
                      <Star size={13} /> {formatNumber(repo.stargazers_count)}
                    </span>
                    <span className="stat-item">
                      <GitFork size={13} /> {formatNumber(repo.forks_count)}
                    </span>
                    {repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' && (
                      <span className="stat-item">{repo.license.spdx_id}</span>
                    )}
                    <span className="stat-item muted-text">
                      Updated {formatDate(repo.updated_at)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}

          {mode === 'code' && (
            <div className="code-results-list">
              {codeResults.map((item, idx) => {
                const [owner, repoName] = item.repository.full_name.split('/');
                return (
                  <article key={`${item.sha}-${idx}`} className="code-card">
                    <div className="code-card-header">
                      <div>
                        <span className="code-repo">{item.repository.full_name}</span>
                        <span className="sep">/</span>
                        <a
                          href={item.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className="code-path"
                        >
                          {item.path} <ExternalLink size={12} />
                        </a>
                      </div>
                      <button
                        type="button"
                        className="btn btn-accent btn-sm"
                        onClick={() => onSelectRepoToScan(owner, repoName)}
                      >
                        <Radar size={14} />
                        Scan Repo
                      </button>
                    </div>
                    {item.text_matches && item.text_matches.length > 0 && (
                      <pre className="code-fragment">
                        {item.text_matches[0].fragment}
                      </pre>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
