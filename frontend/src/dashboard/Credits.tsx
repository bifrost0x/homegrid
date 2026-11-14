import { useEffect, useState } from "react";
import { Heart, X } from "lucide-react";
import { on } from "../events";
import { creditsHidden, repository, setCreditsHidden } from "../project";

/**
 * A small, dismissible note below the dashboard with a link to the project
 * and a way to support it. Hiding it is remembered in this browser and can
 * be undone in Settings → About.
 */
export function Credits({ onSupport }: { onSupport: () => void }) {
  const [hidden, setHidden] = useState(creditsHidden);
  useEffect(() => on("homegrid:credits-changed", setHidden), []);
  if (hidden) return null;
  return (
    <footer className="credits">
      <a href={repository} target="_blank" rel="noopener noreferrer">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        HomeGrid
      </a>
      <span className="credits-love">
        Made with <Heart size={13} aria-hidden="true" fill="currentColor" />
        <span className="visually-hidden">love</span> for the homelab community
      </span>
      <button
        type="button"
        className="text-button"
        aria-label="Support HomeGrid"
        onClick={onSupport}
      >
        Support
      </button>
      <button
        type="button"
        className="icon-button credits-hide"
        aria-label="Hide this note"
        title="Hide this note"
        onClick={() => setCreditsHidden(true)}
      >
        <X size={13} />
      </button>
    </footer>
  );
}
