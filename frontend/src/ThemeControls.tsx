import { useId } from "react";
import { searchEngines, type Settings } from "./lib";

export function LayoutControls({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const searchHintId = useId();
  const update = (key: keyof Settings, value: string) =>
    onChange({ ...settings, [key]: value });
  return (
    <>
      <div className="settings-section-heading">
        <h3>A layout that fits your setup</h3>
        <p>
          Give a large screen room to breathe, or keep everything within reach.
        </p>
      </div>
      <label>
        Dashboard width
        <select
          value={settings.content_width}
          onChange={(e) => update("content_width", e.target.value)}
        >
          <option value="focused">Focused · 1100 px</option>
          <option value="standard">Standard · 1408 px</option>
          <option value="wide">Wide · 1760 px</option>
          <option value="full">Full screen</option>
        </select>
      </label>
      <div className="form-grid">
        <label>
          Groups per row
          <select
            value={settings.group_columns}
            onChange={(e) => update("group_columns", e.target.value)}
          >
            <option value="1">One group</option>
            <option value="2">Two groups</option>
            <option value="3">Three groups</option>
          </select>
        </label>
        <label>
          Applications per row
          <select
            value={settings.columns}
            onChange={(e) => update("columns", e.target.value)}
          >
            <option value="auto">Automatic</option>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={String(n)}>
                {n} applications
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Application style
        <select
          value={settings.card_style}
          onChange={(e) => update("card_style", e.target.value)}
        >
          <option value="cards">Cards · icon and details</option>
          <option value="tiles">Tiles · centered icons</option>
          <option value="list">List · one application per row</option>
        </select>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.status_checks}
          onChange={(e) =>
            onChange({ ...settings, status_checks: e.target.checked })
          }
        />
        Show whether services are online
      </label>
      <p className="field-hint">
        HomeGrid's server then sends a request to each application's address
        about once a minute while the dashboard is open, and reports only online
        or offline.
      </p>
      <label>
        Web search in quick search
        <select
          value={settings.web_search}
          onChange={(e) => update("web_search", e.target.value)}
        >
          <option value="">Off</option>
          {Object.entries(searchEngines).map(([id, engine]) => (
            <option key={id} value={id}>
              {engine.name}
            </option>
          ))}
          <option value="custom">Custom address</option>
        </select>
      </label>
      {settings.web_search === "custom" && (
        <label>
          Search address
          <input
            type="url"
            value={settings.web_search_url}
            maxLength={2048}
            placeholder="https://searx.home.arpa/search?q=%s"
            aria-describedby={searchHintId}
            onChange={(e) => update("web_search_url", e.target.value)}
          />
        </label>
      )}
      <p className="field-hint" id={searchHintId}>
        {settings.web_search === "custom"
          ? "Use %s where the search terms go, for example with a self-hosted SearXNG."
          : "Ctrl+K or Cmd+K then also offers to search the web in a new tab."}
      </p>
      <button
        type="button"
        className="text-button layout-reset"
        onClick={() =>
          onChange({
            ...settings,
            content_width: "standard",
            columns: "auto",
            group_columns: "1",
            card_style: "cards",
          })
        }
      >
        Use default layout
      </button>
    </>
  );
}
