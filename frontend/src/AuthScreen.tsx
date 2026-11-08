import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { api, setSession, type Session } from "./lib";
import { ErrorMessage } from "./components";
import { Brand } from "./Brand";

export function AuthScreen({ setup }: { setup: boolean }) {
  const client = useQueryClient();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const s = await api<Session>(
        "/auth/" + (setup ? "setup" : "login"),
        "POST",
        { username, password },
      );
      setSession(s);
      client.setQueryData(["session"], s);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <Brand />
      <main className="auth-content">
        <span className="auth-symbol">
          <LayoutGrid size={30} />
        </span>
        <h1>{setup ? "A home for your homelab." : "Welcome home."}</h1>
        <p>
          {setup
            ? "Create the administrator account for this HomeGrid."
            : "Sign in to open your dashboard."}
        </p>
        <form onSubmit={submit} className="form">
          <label>
            Username
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={1}
              maxLength={64}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={setup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={setup ? 12 : 1}
            />
          </label>
          {setup && (
            <p className="field-hint">
              Use at least 12 characters. This account manages your HomeGrid.
            </p>
          )}
          <ErrorMessage error={error} />
          <button className="button primary" disabled={busy}>
            {busy ? "Please wait…" : setup ? "Create your HomeGrid" : "Sign in"}
            <ArrowUpRight size={17} />
          </button>
        </form>
      </main>
    </div>
  );
}
