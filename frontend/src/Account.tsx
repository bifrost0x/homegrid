import { useState } from "react";
import { KeyRound, Check } from "lucide-react";
import { z } from "zod";
import { api, setSession, type Session } from "./lib";
import { emit } from "./events";
import { ErrorMessage } from "./components";
const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: z
      .string()
      .min(12, "Use at least 12 characters for your new password.")
      .max(1024, "Use no more than 1024 characters."),
    confirmation: z.string(),
  })
  .refine((data) => data.new_password === data.confirmation, {
    message: "Your new passwords do not match.",
    path: ["confirmation"],
  });
export function PasswordForm() {
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false);
  return (
    <section className="account-panel">
      <div className="settings-intro">
        <KeyRound size={22} />
        <div>
          <h3>Your account, kept private.</h3>
          <p>
            Change your administrator password. Other signed-in devices will be
            signed out.
          </p>
        </div>
      </div>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(false);
          setError(undefined);
          const result = passwordSchema.safeParse({
            current_password: current,
            new_password: password,
            confirmation,
          });
          if (!result.success) {
            setError(result.error.issues[0].message);
            return;
          }
          setBusy(true);
          try {
            const session = await api<Session>("/auth/password", "POST", {
              current_password: current,
              new_password: password,
            });
            setSession(session);
            emit("homegrid:session-refreshed", session);
            setCurrent("");
            setPassword("");
            setConfirmation("");
            setSaved(true);
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            maxLength={1024}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            minLength={12}
            maxLength={1024}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-describedby="password-guidance"
          />
        </label>
        <p className="field-hint" id="password-guidance">
          At least 12 characters. A memorable passphrase works well.
        </p>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            minLength={12}
            maxLength={1024}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        </label>
        <ErrorMessage error={error} />
        {saved && (
          <p role="status" className="notice">
            <Check size={16} />
            Password changed. You’re still signed in on this device.
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Changing password…" : "Change password"}
        </button>
      </form>
    </section>
  );
}
