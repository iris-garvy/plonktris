import { useEffect, useState, type SubmitEvent } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { api, errorMessage, setSession, type User } from '../api';
import './AuthModal.css';

interface AuthModalProps {
  onAuthed: (user: User) => void;
  onClose: () => void;
  /** why we're asking, e.g. "log in to save this solve" */
  reason?: string | null;
}

export default function AuthModal({ onAuthed, onClose, reason }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!username || !password || busy) return;
    if (mode === 'register') {
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        setError('username: letters, numbers, _ and - only');
        return;
      }
      if (password.length < 8) {
        setError('password must be at least 8 characters');
        return;
      }
      if (password.toLowerCase() === username.toLowerCase()) {
        setError('password cannot be your username');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const fn = mode === 'login' ? api.login : api.register;
      const { token, user } = await fn(username, password);
      setSession(token, user);
      onAuthed(user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel auth-panel" role="dialog" aria-modal="true" aria-label={mode === 'login' ? 'log in' : 'register'} onClick={e => e.stopPropagation()}>
        {reason && <div className="auth-reason">{reason}</div>}
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(null); }}
          >
            LOG IN
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(null); }}
          >
            REGISTER
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <input
            className="auth-input"
            type="text"
            placeholder="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            maxLength={32}
            autoFocus
            autoComplete="username"
          />
          <input
            className="auth-input"
            type="password"
            placeholder="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            maxLength={128}
          />
          {mode === 'register' && (
            <div className="auth-hint">at least 8 characters</div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button
            className="modal-btn submit auth-submit"
            type="submit"
            disabled={busy || !username || !password}
          >
            {busy ? '…' : mode === 'login'
              ? <><LogIn className="glyph-icon glyph-lead" />log in</>
              : <><UserPlus className="glyph-icon glyph-lead" />create account</>}
          </button>
        </form>
      </div>
    </div>
  );
}
