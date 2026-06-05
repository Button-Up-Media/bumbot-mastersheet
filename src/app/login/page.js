'use client';

import { useState } from 'react';
import BumbotMark from '@/components/BumbotMark.js';

// Passcode gate. Posts the passcode to /api/login, which (on success) sets the
// httpOnly auth cookie; we then hard-navigate to '/' so the Edge middleware
// re-evaluates with the fresh cookie. The passcode is never stored client-side.
export default function LoginPage() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      if (res.ok) {
        window.location.assign('/');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Incorrect passcode.');
      setBusy(false);
    } catch {
      setError('Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={onSubmit}>
        <BumbotMark size={44} className="login__mark" />
        <h1 className="login__title">BUM BOT</h1>
        <div className="login__sub">Status Board</div>
        <input
          className="input"
          type="password"
          inputMode="text"
          autoFocus
          autoComplete="current-password"
          placeholder="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          aria-label="Passcode"
        />
        <button className="btn login__btn" type="submit" disabled={busy || !passcode}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        <div className="login__error" role="alert">
          {error}
        </div>
      </form>
    </main>
  );
}
