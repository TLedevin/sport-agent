import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api";

export default function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login(password);
      onLogin(token);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Wrong password." : "Can't reach the server. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark" aria-hidden />
          Sport Agent
        </div>
        <p className="login-sub">Your training, at a glance.</p>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary block" disabled={busy || !password}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </main>
  );
}
