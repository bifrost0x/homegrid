import { type Settings } from "./lib";

export function LayoutControls({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
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
