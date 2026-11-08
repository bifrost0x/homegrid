import { useState } from "react";
import { ArrowRight, Sparkles, X } from "lucide-react";
import { api } from "../lib";
import { ErrorMessage, Icon, Modal } from "../components";
import type { LogoSuggestion } from "./useLogoSuggestions";

const signalText = {
  name: "from its name",
  host: "from its address",
  path: "from its address",
  port: "from its default port",
} as const;

export function LogoSuggestionBanner({
  count,
  onReview,
  onDismiss,
}: {
  count: number;
  onReview: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="logo-banner" role="status">
      <Sparkles size={17} />
      <span>
        {count === 1
          ? "HomeGrid recognized the logo for 1 application."
          : `HomeGrid recognized logos for ${count} applications.`}
      </span>
      <button className="button secondary" type="button" onClick={onReview}>
        Review logos
      </button>
      <button
        className="icon-button"
        type="button"
        aria-label="Dismiss logo suggestions"
        onClick={onDismiss}
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function LogoSuggestionDialog({
  suggestions,
  onClose,
  onApplied,
}: {
  suggestions: LogoSuggestion[];
  onClose: () => void;
  onApplied: (count: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState(
    () =>
      new Set(suggestions.filter((s) => s.recommended).map((s) => s.app.id)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  function toggle(id: number, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  async function apply() {
    setBusy(true);
    setError(undefined);
    let applied = 0;
    const failed: string[] = [];
    for (const { app, service } of suggestions) {
      if (!selected.has(app.id)) continue;
      try {
        await api("/apps/" + app.id, "PATCH", { ...app, icon: service.icon });
        applied++;
      } catch {
        failed.push(app.name);
      }
    }
    await onApplied(applied);
    setBusy(false);
    if (failed.length)
      setError(
        new Error(
          `Could not update ${failed.join(", ")}. The others were saved; try again.`,
        ),
      );
    else onClose();
  }
  return (
    <Modal
      title="Use recognized logos"
      description="Choose which applications get their service logo. Your own uploads are never replaced."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ul className="logo-suggestions">
        {suggestions.map(({ app, service, recommended }) => (
          <li key={app.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(app.id)}
                disabled={busy}
                onChange={(e) => toggle(app.id, e.target.checked)}
              />
              <span className="logo-suggestion-icons" aria-hidden="true">
                <Icon app={app} />
                <ArrowRight size={14} />
                <Icon app={{ ...app, icon: service.icon }} />
              </span>
              <span className="logo-suggestion-text">
                <strong>{app.name}</strong>
                <small>
                  {service.name} logo, recognized {signalText[service.signal]}
                  {!recommended && " · replaces the icon you picked"}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorMessage error={error} />
      <div className="dialog-footer">
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={busy || !selected.size}
          onClick={() => void apply()}
        >
          {busy
            ? "Saving…"
            : selected.size === 1
              ? "Use 1 logo"
              : `Use ${selected.size} logos`}
        </button>
      </div>
    </Modal>
  );
}
