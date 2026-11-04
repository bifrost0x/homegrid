import { LayoutGrid, Plus, Sparkles } from "lucide-react";
import { serviceIconUrl } from "./serviceIcons";
export function FirstRun({
  onAdd,
  onExamples,
  busy,
}: {
  onAdd: () => void;
  onExamples: () => void;
  busy: boolean;
}) {
  return (
    <section
      className="first-app welcome-screen"
      aria-label="Welcome to HomeGrid"
    >
      <span className="empty-symbol">
        <LayoutGrid size={30} />
      </span>
      <div className="welcome-services" aria-hidden="true">
        {["nextcloud", "jellyfin", "immich", "homeassistant", "grafana"].map(
          (id) => (
            <span key={id}>
              <img
                src={serviceIconUrl("service:" + id)}
                alt=""
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            </span>
          ),
        )}
      </div>
      <h1>Your services. Your space.</h1>
      <p>
        Bring your favorite self-hosted applications together.
        <br />
        Start with one link, or explore an example layout.
      </p>
      <div className="welcome-actions">
        <button className="button primary" onClick={onAdd} disabled={busy}>
          <Plus size={18} />
          Add your first application
        </button>
        <button
          className="button secondary"
          onClick={onExamples}
          disabled={busy}
        >
          <Sparkles size={17} />
          {busy ? "Loading…" : "Load example applications"}
        </button>
      </div>
      <p className="welcome-note">
        Examples stay local. Add your own URLs before launching them.
      </p>
    </section>
  );
}
