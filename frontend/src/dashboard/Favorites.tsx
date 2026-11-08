import { ArrowUpRight, Star } from "lucide-react";
import { isExampleApp, type Application } from "../lib";
import { Icon } from "../components";

export function Favorites({
  apps,
  onConfigure,
}: {
  apps: Application[];
  onConfigure: (app: Application) => void;
}) {
  const favorites = apps.filter((app) => app.favorite);
  if (!favorites.length) return null;
  return (
    <section className="favorites" aria-label="Favorites">
      <div className="favorites-heading">
        <Star size={15} />
        <h2>Favorites</h2>
      </div>
      <div className="favorite-links">
        {favorites.map((app) =>
          isExampleApp(app) ? (
            <button
              type="button"
              key={app.id}
              className="favorite-link"
              onClick={() => onConfigure(app)}
            >
              <Icon app={app} />
              <span>Configure {app.name}</span>
            </button>
          ) : (
            <a
              key={app.id}
              href={app.url}
              target={app.open_in_new_tab ? "_blank" : undefined}
              rel={app.open_in_new_tab ? "noopener noreferrer" : undefined}
              className="favorite-link"
              aria-label={"Open favorite " + app.name}
            >
              <Icon app={app} />
              <span>{app.name}</span>
              <ArrowUpRight size={14} />
            </a>
          ),
        )}
      </div>
    </section>
  );
}
