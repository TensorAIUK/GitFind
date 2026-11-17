import React, { useEffect, useState } from 'react';
import { X, Copy, Check, ExternalLink, FileCode2 } from 'lucide-react';
import { getFileContent } from '../services/githubApi';

interface FilePreviewModalProps {
  token: string;
  target: {
    owner: string;
    repo: string;
    path: string;
    branch: string;
    line?: number;
  } | null;
  onClose: () => void;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  token,
  target,
  onClose,
}) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setContent('');

    getFileContent(token, target.owner, target.repo, target.path, target.branch, controller.signal)
      .then((text) => setContent(text))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Failed to load file');
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [token, target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  const githubUrl = target.line
    ? `https://github.com/${target.owner}/${target.repo}/blob/${target.branch}/${target.path}#L${target.line}`
    : `https://github.com/${target.owner}/${target.repo}/blob/${target.branch}/${target.path}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const lines = content.split(/\r?\n/);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="preview-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="preview-modal-header">
          <div className="preview-title-wrap">
            <FileCode2 size={18} className="accent-icon" />
            <div>
              <div className="preview-repo-name">
                {target.owner}/{target.repo}
              </div>
              <div className="preview-file-path">
                {target.path}
                {target.line ? `:${target.line}` : ''}
              </div>
            </div>
          </div>

          <div className="preview-actions">
            {content && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
            >
              GitHub <ExternalLink size={13} />
            </a>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="preview-modal-body">
          {loading && (
            <div className="loading-panel">
              <div className="spinner" />
              <p>Loading file...</p>
            </div>
          )}
          {error && <div className="error-banner">{error}</div>}
          {!loading && !error && (
            <div className="code-viewer">
              {lines.slice(0, 800).map((lineText, idx) => {
                const lineNum = idx + 1;
                const isHighlighted = target.line === lineNum;
                return (
                  <div
                    key={lineNum}
                    className={`code-line ${isHighlighted ? 'highlighted' : ''}`}
                  >
                    <span className="line-num">{lineNum}</span>
                    <span className="line-text">{lineText || ' '}</span>
                  </div>
                );
              })}
              {lines.length > 800 && (
                <div className="code-truncated-note">
                  Showing first 800 of {lines.length} lines. Open on GitHub to view the full file.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
