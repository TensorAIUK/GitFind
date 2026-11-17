import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, ExternalLink, X } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onAuthenticate: (token: string, persist: boolean) => Promise<void>;
  canClose: boolean;
  error: string | null;
  loading: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticate,
  canClose,
  error,
  loading,
}) => {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [persist, setPersist] = useState(true);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    await onAuthenticate(token.trim(), persist);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div className="modal-card">
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="icon-badge">
              <KeyRound size={18} />
            </div>
            <div>
              <h2 id="auth-modal-title">Connect GitHub Credentials</h2>
              <p className="muted-text">Authenticate searches &amp; scans with your Personal Access Token</p>
            </div>
          </div>
          {canClose && onClose && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label" htmlFor="pat-input">
            GitHub Personal Access Token (PAT)
          </label>
          <div className="input-with-action">
            <input
              id="pat-input"
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_... or github_pat_..."
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="input-action-btn"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={persist}
              onChange={(e) => setPersist(e.target.checked)}
            />
            <span>Remember token in this browser (localStorage)</span>
          </label>

          {error && <div className="error-banner">{error}</div>}

          <div className="security-note">
            <ShieldCheck size={16} className="shrink-0" />
            <span>
              Zero-backend architecture: your token never leaves your browser and is sent directly to{' '}
              <code>api.github.com</code>.
            </span>
          </div>

          <div className="token-help">
            <p className="help-title">How to get a token:</p>
            <ol>
              <li>
                Open{' '}
                <a
                  href="https://github.com/settings/tokens?type=beta"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub Fine-grained Tokens <ExternalLink size={12} />
                </a>{' '}
                (or Classic Tokens).
              </li>
              <li>
                Grant <strong>Contents (Read-only)</strong> &amp; <strong>Metadata (Read-only)</strong>{' '}
                (or <code>repo</code> scope on classic tokens to scan private repos).
              </li>
            </ol>
          </div>

          <div className="modal-actions">
            {canClose && onClose && (
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!token.trim() || loading}
            >
              {loading ? 'Verifying...' : 'Connect GitHub'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
