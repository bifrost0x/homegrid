import { useEffect, useState } from "react";
import { Search, LayoutGrid, Star } from "lucide-react";
import { Icon } from "./components";
import { appHostname, type Application, type Settings } from "./lib";
import { appearanceStyle, wallpaperUrl } from "./themes";

export function AppearancePreview({
  settings,
  app,
  layout = false,
}: {
  settings: Settings;
  app?: Application;
  layout?: boolean;
}) {
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const theme =
    settings.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : settings.theme;
  const shown = app ?? {
    name: "Example application",
    url: "https://service.home",
    description: "Your service description appears here.",
    icon: "builtin:server",
    favorite: false,
  };
  return (
    <aside className="appearance-preview-column">
      <section
        className={
          "appearance-preview " +
          settings.density +
          " " +
          settings.radius +
          (settings.blur ? " blurred" : "")
        }
        aria-label="Appearance preview"
        data-theme={theme}
        data-accent={settings.accent}
        data-design={settings.design}
        data-style={settings.card_style}
        data-strength={settings.background_strength}
        style={appearanceStyle(settings)}
      >
        {wallpaperUrl(settings) && (
          <div
            className="preview-background"
            data-testid="preview-wallpaper"
            style={{
              backgroundImage: `url(${JSON.stringify(wallpaperUrl(settings))})`,
            }}
          />
        )}
        <div className="preview-content">
          <div className="preview-brand">
            <LayoutGrid size={17} />
            <span>HomeGrid</span>
          </div>
          <h3>{settings.title || "Your dashboard title"}</h3>
          <div className="preview-search" aria-hidden="true">
            <Search size={14} />
            <span>Find an application…</span>
          </div>
          <div className="preview-category">
            <span>Your applications</span>
            {shown.favorite && <Star size={12} fill="currentColor" />}
          </div>
          <article className="app-card preview-card">
            <div className="app-link">
              <Icon app={shown} />
              <span className="app-copy">
                <strong>{shown.name}</strong>
                {settings.show_descriptions && (
                  <small>{shown.description || appHostname(shown.url)}</small>
                )}
              </span>
            </div>
          </article>
          {layout && (
            <div
              className="layout-diagram"
              role="img"
              aria-label={`${settings.group_columns} groups per row, ${settings.columns === "auto" ? "automatic" : settings.columns} application columns, ${settings.card_style}`}
              style={{
                gridTemplateColumns: `repeat(${settings.group_columns}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: 3 }, (_, group) => (
                <div key={group} className="diagram-group">
                  <span />
                  <div
                    style={{
                      gridTemplateColumns: `repeat(${settings.card_style === "list" ? 1 : settings.columns === "auto" ? 3 : settings.columns}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from({ length: 6 }, (_, card) => (
                      <i key={card} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      <p className="preview-caption">
        {layout && (
          <>
            Layout diagram is schematic. Actual columns adapt to screen and
            group width.{" "}
          </>
        )}
        {app
          ? "Your application, your look."
          : "Example application shown for preview."}{" "}
        Changes stay here until you save.
      </p>
    </aside>
  );
}
