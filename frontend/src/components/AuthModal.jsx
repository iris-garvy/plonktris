import { useState } from 'react';
import { api, setToken } from '../api';
import './AuthModal.css';

export default function AuthModal({ onAuthed, onClose }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
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
      setToken(token);
      onAuthed(user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel auth-panel" onClick={e => e.stopPropagation()}>
        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(null); }}
          >
            LOG IN
          </button>
          <button
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
            {busy ? '…' : mode === 'login' ? '▶ log in' : '▶ create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
