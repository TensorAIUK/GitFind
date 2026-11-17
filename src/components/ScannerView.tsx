import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  AlertTriangle,
  Info,
  Play,
  Square,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  Activity,
  FolderTree,
  Search,
} from 'lucide-react';
import {
  FindingSeverity,
  GitHubRepo,
  GitTreeItem,
  ScanOptions,
  ScanResult,
} from '../types/github';
import { getRepo, getRepoTree } from '../services/githubApi';
import {
  analyzeRepoHealth,
  DeepScanProgress,
  exportScanAsMarkdown,
  isScannableTextFile,
  maskSecret,
  runDeepScan,
  scanTreeForSensitiveFiles,
} from '../services/scanner';

interface ScannerViewProps {
  token: string;
  owner: string;
  repoName: string;
  onBack: () => void;
  onPreviewFile: (target: {
    owner: string;
    repo: string;
    path: string;
    branch: string;
    line?: number;
  }) => void;
}

type ScannerTab = 'findings' | 'health' | 'files';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const ScannerView: React.FC<ScannerViewProps> = ({
  token,
  owner,
  repoName,
  onBack,
  onPreviewFile,
}) => {
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const [tree, setTree] = useState<GitTreeItem[]>([]);
  const [truncatedTree, setTruncatedTree] = useState(false);

  const [options, setOptions] = useState<ScanOptions>({
    checkSecrets: true,
    checkSecurity: true,
    checkHygiene: true,
    customPattern: '',
    customCaseSensitive: false,
    maxFiles: 75,
  });

  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DeepScanProgress | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [activeTab, setActiveTab] = useState<ScannerTab>('findings');
  const [severityFilter, setSeverityFilter] = useState<'all' | FindingSeverity>('all');
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [fileFilter, setFileFilter] = useState('');

  // Validate custom regex
  const regexError = useMemo(() => {
    if (!options.customPattern.trim()) return null;
    try {
      new RegExp(options.customPattern.trim());
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [options.customPattern]);

  // Load repo & tree on mount
  useEffect(() => {
    const controller = new AbortController();
    setLoadingTree(true);
    setTreeError(null);
    setScanResult(null);

    (async () => {
      try {
        const repoData = await getRepo(token, owner, repoName, controller.signal);
        setRepo(repoData);

        const treeData = await getRepoTree(
          token,
          owner,
          repoName,
          repoData.default_branch,
          controller.signal
        );
        setTree(treeData.tree);
        setTruncatedTree(treeData.truncated);

        // Immediately produce a Quick Tree Scan result
        const health = analyzeRepoHealth(treeData.tree);
        const treeFindings = scanTreeForSensitiveFiles(treeData.tree);
        setScanResult({
          repo: repoData,
          scannedAt: new Date().toISOString(),
          mode: 'tree',
          filesScanned: 0,
          filesSkipped: health.totalFiles,
          totalTreeFiles: health.totalFiles,
          truncatedTree: treeData.truncated,
          health,
          findings: treeFindings,
          tree: treeData.tree,
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setTreeError((err as Error).message || 'Failed to load repository');
        }
      } finally {
        setLoadingTree(false);
      }
    })();

    return () => {
      controller.abort();
      abortRef.current?.abort();
    };
  }, [token, owner, repoName]);

  const scannableCount = useMemo(
    () => tree.filter(isScannableTextFile).length,
    [tree]
  );

  const handleRunDeepScan = async () => {
    if (!repo || regexError) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setScanning(true);
    setScanError(null);
    setProgress({ scanned: 0, total: Math.min(scannableCount, options.maxFiles), currentPath: '' });

    try {
      const result = await runDeepScan({
        token,
        repo,
        tree,
        truncatedTree,
        options,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      setScanResult(result);
      setActiveTab('findings');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setScanError((err as Error).message || 'Deep scan failed');
      }
    } finally {
      setScanning(false);
    }
  };

  const handleStopScan = () => {
    abortRef.current?.abort();
    setScanning(false);
  };

  const downloadFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredFindings = useMemo(() => {
    if (!scanResult) return [];
    if (severityFilter === 'all') return scanResult.findings;
    return scanResult.findings.filter((f) => f.severity === severityFilter);
  }, [scanResult, severityFilter]);

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, info: 0 };
    if (!scanResult) return c;
    for (const f of scanResult.findings) {
      c[f.severity]++;
    }
    return c;
  }, [scanResult]);

  const filteredTreeFiles = useMemo(() => {
    const blobs = tree.filter((t) => t.type === 'blob');
    if (!fileFilter.trim()) return blobs.slice(0, 250);
    const q = fileFilter.toLowerCase();
    return blobs.filter((b) => b.path.toLowerCase().includes(q)).slice(0, 250);
  }, [tree, fileFilter]);

  return (
    <div className="scanner-view">
      <div className="scanner-topbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Search
        </button>

        {scanResult && (
          <div className="export-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                downloadFile(
                  `${owner}-${repoName}-scan.json`,
                  JSON.stringify(scanResult, null, 2),
                  'application/json'
                )
              }
            >
              <Download size={14} /> JSON
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                downloadFile(
                  `${owner}-${repoName}-scan.md`,
                  exportScanAsMarkdown(scanResult),
                  'text/markdown'
                )
              }
            >
              <Download size={14} /> Markdown
            </button>
          </div>
        )}
      </div>

      {loadingTree && (
        <div className="panel loading-panel">
          <div className="spinner" />
          <p>Fetching repository metadata &amp; file tree for <strong>{owner}/{repoName}</strong>...</p>
        </div>
      )}

      {treeError && (
        <div className="panel">
          <div className="error-banner">{treeError}</div>
        </div>
      )}

      {!loadingTree && repo && scanResult && (
        <>
          {/* Repo Header + Scan Config */}
          <section className="panel scanner-header-panel">
            <div className="scanner-repo-info">
              <div className="repo-title-row">
                <img src={repo.owner.avatar_url} alt={repo.owner.login} className="avatar-sm" />
                <div>
                  <h2 className="scanner-repo-title">
                    <a href={repo.html_url} target="_blank" rel="noreferrer">
                      {repo.full_name} <ExternalLink size={15} />
                    </a>
                  </h2>
                  <p className="muted-text">{repo.description || 'No description'}</p>
                </div>
              </div>
              <div className="scanner-badges">
                <span className="pill pill-neutral">Branch: {repo.default_branch}</span>
                <span className="pill pill-neutral">
                  {scanResult.health.totalFiles.toLocaleString()} files ({formatBytes(scanResult.health.totalSizeBytes)})
                </span>
                <span className="pill pill-neutral">{scannableCount} scannable text files</span>
              </div>
            </div>

            <div className="scan-config-box">
              <div className="scan-toggles">
                <label className="checkbox-chip">
                  <input
                    type="checkbox"
                    checked={options.checkSecrets}
                    onChange={(e) => setOptions({ ...options, checkSecrets: e.target.checked })}
                  />
                  <span>Secrets &amp; API Keys</span>
                </label>
                <label className="checkbox-chip">
                  <input
                    type="checkbox"
                    checked={options.checkSecurity}
                    onChange={(e) => setOptions({ ...options, checkSecurity: e.target.checked })}
                  />
                  <span>Security Sinks</span>
                </label>
                <label className="checkbox-chip">
                  <input
                    type="checkbox"
                    checked={options.checkHygiene}
                    onChange={(e) => setOptions({ ...options, checkHygiene: e.target.checked })}
                  />
                  <span>TODO / FIXME</span>
                </label>
              </div>

              <div className="scan-inputs-row">
                <div className="custom-regex-wrap">
                  <input
                    type="text"
                    value={options.customPattern}
                    onChange={(e) => setOptions({ ...options, customPattern: e.target.value })}
                    placeholder="Optional custom regex or keyword (e.g. fetch\(|STRIPE_)"
                  />
                  {regexError && <span className="inline-error">{regexError}</span>}
                </div>

                <label className="max-files-select">
                  <span>Max files:</span>
                  <select
                    value={options.maxFiles}
                    onChange={(e) => setOptions({ ...options, maxFiles: Number(e.target.value) })}
                  >
                    <option value={30}>30</option>
                    <option value={75}>75</option>
                    <option value={150}>150</option>
                    <option value={300}>300</option>
                  </select>
                </label>

                {!scanning ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={Boolean(regexError) || scannableCount === 0}
                    onClick={() => void handleRunDeepScan()}
                  >
                    <Play size={15} />
                    Run Deep Scan
                  </button>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={handleStopScan}>
                    <Square size={15} />
                    Stop
                  </button>
                )}
              </div>

              {scanning && progress && (
                <div className="progress-wrap">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${progress.total > 0 ? Math.round((progress.scanned / progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <div className="progress-meta">
                    <span>
                      Scanning {progress.scanned} / {progress.total} files
                    </span>
                    <span className="muted-text truncate">{progress.currentPath}</span>
                  </div>
                </div>
              )}

              {scanError && <div className="error-banner">{scanError}</div>}
            </div>
          </section>

          {/* Summary Strip */}
          <div className="summary-strip">
            <div className="summary-card high">
              <ShieldAlert size={18} />
              <div>
                <div className="summary-value">{counts.high}</div>
                <div className="summary-label">High Severity</div>
              </div>
            </div>
            <div className="summary-card medium">
              <AlertTriangle size={18} />
              <div>
                <div className="summary-value">{counts.medium}</div>
                <div className="summary-label">Medium Severity</div>
              </div>
            </div>
            <div className="summary-card info">
              <Info size={18} />
              <div>
                <div className="summary-value">{counts.info}</div>
                <div className="summary-label">Info / Hygiene</div>
              </div>
            </div>
            <div className="summary-card neutral">
              <FileCode2 size={18} />
              <div>
                <div className="summary-value">
                  {scanResult.mode === 'deep' ? scanResult.filesScanned : 'Tree only'}
                </div>
                <div className="summary-label">
                  {scanResult.mode === 'deep' ? 'Files Deep-Scanned' : 'Run Deep Scan for content'}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="scanner-tabs">
            <button
              type="button"
              className={activeTab === 'findings' ? 'active' : ''}
              onClick={() => setActiveTab('findings')}
            >
              <ShieldAlert size={15} />
              Findings ({scanResult.findings.length})
            </button>
            <button
              type="button"
              className={activeTab === 'health' ? 'active' : ''}
              onClick={() => setActiveTab('health')}
            >
              <Activity size={15} />
              Health &amp; Structure
            </button>
            <button
              type="button"
              className={activeTab === 'files' ? 'active' : ''}
              onClick={() => setActiveTab('files')}
            >
              <FolderTree size={15} />
              File Explorer ({scanResult.health.totalFiles})
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'findings' && (
            <section className="panel">
              <div className="findings-toolbar">
                <div className="segmented-control">
                  {(['all', 'high', 'medium', 'info'] as const).map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      className={severityFilter === sev ? 'active' : ''}
                      onClick={() => setSeverityFilter(sev)}
                    >
                      {sev.toUpperCase()}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setRevealSecrets((v) => !v)}
                >
                  {revealSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
                  {revealSecrets ? 'Mask Secrets' : 'Reveal Secrets'}
                </button>
              </div>

              {filteredFindings.length === 0 ? (
                <div className="empty-state">
                  <CheckCircle2 size={32} className="ok-icon" />
                  <p>
                    {scanResult.mode === 'tree'
                      ? 'No suspicious files in the repository tree. Click "Run Deep Scan" above to inspect file contents.'
                      : 'No findings matched the selected filter.'}
                  </p>
                </div>
              ) : (
                <div className="findings-list">
                  {filteredFindings.map((f) => {
                    const githubLineUrl = f.line
                      ? `${repo.html_url}/blob/${repo.default_branch}/${f.path}#L${f.line}`
                      : `${repo.html_url}/blob/${repo.default_branch}/${f.path}`;

                    const displaySnippet =
                      f.snippet && f.category === 'secret' && !revealSecrets
                        ? maskSecret(f.snippet, f.matchText)
                        : f.snippet;

                    return (
                      <article key={f.id} className={`finding-card sev-${f.severity}`}>
                        <div className="finding-header">
                          <div className="finding-title-group">
                            <span className={`sev-badge sev-${f.severity}`}>
                              {f.severity.toUpperCase()}
                            </span>
                            <strong>{f.title}</strong>
                            <span className="pill pill-neutral">{f.category}</span>
                          </div>
                          <div className="export-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                onPreviewFile({
                                  owner: repo.owner.login,
                                  repo: repo.name,
                                  path: f.path,
                                  branch: repo.default_branch,
                                  line: f.line,
                                })
                              }
                            >
                              <Eye size={12} /> Preview
                            </button>
                            <a
                              href={githubLineUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="finding-link"
                            >
                              {f.path}
                              {f.line ? `:${f.line}` : ''}
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        </div>
                        <p className="finding-desc">{f.description}</p>
                        {displaySnippet && <pre className="finding-snippet">{displaySnippet}</pre>}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === 'health' && (
            <section className="panel health-panel">
              <div className="health-grid">
                <div>
                  <h3>Repository Checklist</h3>
                  <ul className="checklist">
                    {[
                      { label: 'README documentation', ok: scanResult.health.hasReadme },
                      { label: 'Open-source LICENSE', ok: scanResult.health.hasLicense },
                      { label: 'CI/CD Workflows', ok: scanResult.health.hasCi },
                      { label: 'Automated Tests', ok: scanResult.health.hasTests },
                      { label: 'Docker / Container config', ok: scanResult.health.hasDocker },
                      { label: '.gitignore present', ok: scanResult.health.hasGitignore },
                    ].map((item) => (
                      <li key={item.label} className={item.ok ? 'ok' : 'missing'}>
                        {item.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                        <span>{item.label}</span>
                      </li>
                    ))}
                  </ul>

                  {scanResult.health.manifests.length > 0 && (
                    <div className="manifests-box">
                      <h4>Detected Manifests</h4>
                      <div className="topic-list">
                        {scanResult.health.manifests.map((m) => (
                          <span key={m} className="topic-chip">
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <h3>Top File Extensions</h3>
                  <div className="ext-list">
                    {scanResult.health.extensions.map((ext) => {
                      const pct = Math.max(
                        4,
                        Math.round((ext.count / Math.max(1, scanResult.health.totalFiles)) * 100)
                      );
                      return (
                        <div key={ext.ext} className="ext-row">
                          <div className="ext-label">
                            <code>{ext.ext}</code>
                            <span className="muted-text">
                              {ext.count} files · {formatBytes(ext.bytes)}
                            </span>
                          </div>
                          <div className="ext-bar-bg">
                            <div className="ext-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'files' && (
            <section className="panel">
              <div className="file-filter-bar">
                <Search size={16} />
                <input
                  type="text"
                  value={fileFilter}
                  onChange={(e) => setFileFilter(e.target.value)}
                  placeholder="Filter repository files by path..."
                />
              </div>
              <div className="file-list">
                {filteredTreeFiles.map((item) => (
                  <div key={item.path} className="file-row">
                    <button
                      type="button"
                      className="file-preview-btn"
                      onClick={() =>
                        onPreviewFile({
                          owner: repo.owner.login,
                          repo: repo.name,
                          path: item.path,
                          branch: repo.default_branch,
                        })
                      }
                    >
                      {item.path}
                    </button>
                    <div className="export-actions" style={{ alignItems: 'center' }}>
                      <span className="muted-text">{formatBytes(item.size ?? 0)}</span>
                      <a
                        href={`${repo.html_url}/blob/${repo.default_branch}/${item.path}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open on GitHub"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};
