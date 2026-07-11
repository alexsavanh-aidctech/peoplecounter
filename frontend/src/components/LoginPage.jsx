import { useState } from 'react';
import { L } from '../labels.js';

// Shared-password login screen (Lao). The backend verifies the password and
// issues the token — this page only collects the password and localizes errors.
export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(password);
    } catch (err) {
      setError(err?.message === 'wrong-password' ? L.loginWrongPassword : L.loginFailed);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="login-logo" src="/logo.png" alt="AIDC" />
        <h1 className="login-title">{L.loginTitle}</h1>
        <div className="login-sub">{L.loginSubtitle}</div>
        <input
          className="login-input"
          type="password"
          placeholder={L.loginPlaceholder}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <div className="login-error">⚠ {error}</div>}
        <button className="login-btn" type="submit" disabled={busy || !password}>
          {busy ? L.loginBusy : L.loginButton}
        </button>
      </form>
    </div>
  );
}
