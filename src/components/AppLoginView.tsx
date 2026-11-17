import React, { useState } from 'react';
import { Lock, Radar, UserPlus, LogIn, Eye, EyeOff } from 'lucide-react';
import { AppUser, loginApp, registerApp } from '../services/appAuth';

interface AppLoginViewProps {
  configured: boolean;
  onSuccess: (user: AppUser) => void;
}

export const AppLoginView: React.FC<AppLoginViewProps> = ({ configured, onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user =
        mode === 'login'
          ? await loginApp(username, password)
          : await registerApp(username, password, inviteCode);
      onSuccess(user);
    } catch (err) {
      setError((err as Error).message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-gate-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-logo">
            <Radar size={22} />
          </div>
          <div>
            <h1>GitFind</h1>
            <p className="muted-text">Sign in to access your repository scanner</p>
          </div>
        </div>

        <div className="segmented-control login-tabs" role="tablist">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => {
              setMode('login');
              setError(null);
            }}
          >
            <LogIn size={14} /> Sign In
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => {
              setMode('register');
              setError(null);
            }}
          >
            <UserPlus size={14} /> Create Account
          </button>
        </div>

        {!configured && (
          <div className="error-banner">
            App authentication is not configured yet. Add <code>APP_USERNAME</code>,{' '}
            <code>APP_PASSWORD</code>, and <code>AUTH_SECRET</code> in Cloudflare Worker{' '}
            <strong>Settings → Variables and Secrets</strong>.
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <label className="field-label" htmlFor="app-username">
              Username
            </label>
            <input
              id="app-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
              style={{ width: '100%', marginTop: '0.3rem' }}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="app-password">
              Password
            </label>
            <div className="input-with-action" style={{ marginTop: '0.3rem' }}>
              <input
                id="app-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
              <button
                type="button"
                className="input-action-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="field-label" htmlFor="app-invite">
                Invite Code
              </label>
              <input
                id="app-invite"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Required invite code"
                autoComplete="off"
                required
                style={{ width: '100%', marginTop: '0.3rem' }}
              />
            </div>
          )}

          {error && <div className="error-banner">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            <Lock size={15} />
            {loading
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign In to GitFind'
                : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
};
