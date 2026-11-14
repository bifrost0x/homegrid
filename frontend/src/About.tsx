import { useEffect, useState } from "react";
import {
  BookOpen,
  Bug,
  ExternalLink,
  Code,
  Globe,
  Heart,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { on } from "./events";
import { api } from "./lib";
import {
  creditsHidden,
  donations,
  repository,
  setCreditsHidden,
} from "./project";
const links = [
  {
    label: "Website",
    hint: "Guides for installation and updates",
    href: "https://bifrost0x.github.io/homegrid/",
    Icon: Globe,
  },
  {
    label: "Releases",
    hint: "Versions, release notes and images",
    href: repository + "/releases",
    Icon: Tag,
  },
  {
    label: "Changelog",
    hint: "Everything that changed",
    href: repository + "/blob/main/CHANGELOG.md",
    Icon: BookOpen,
  },
  {
    label: "Report a problem",
    hint: "Open an issue on GitHub",
    href: repository + "/issues/new/choose",
    Icon: Bug,
  },
  {
    label: "Security policy",
    hint: "Report vulnerabilities privately",
    href: repository + "/security/policy",
    Icon: ShieldCheck,
  },
  {
    label: "Source code",
    hint: "Apache License 2.0",
    href: repository,
    Icon: Code,
  },
];

/** Version information and project links. Links open GitHub; nothing is sent. */
export function About() {
  const [health, setHealth] = useState<{
    isPending: boolean;
    error?: unknown;
    data?: { version: string; commit: string };
  }>({ isPending: true });
  useEffect(() => {
    let current = true;
    api<{ status: string; version: string; commit: string }>("/health").then(
      (data) => current && setHealth({ isPending: false, data }),
      (error: unknown) => current && setHealth({ isPending: false, error }),
    );
    return () => {
      current = false;
    };
  }, []);
  const [proxy, setProxy] = useState("");
  useEffect(() => {
    let current = true;
    // Diagnostics are a hint only; the About section works without them.
    api<{ untrusted_proxy: string }>("/diagnostics").then(
      (data) => current && setProxy(data.untrusted_proxy || ""),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);
  const [noteHidden, setNoteHidden] = useState(creditsHidden);
  useEffect(() => on("homegrid:credits-changed", setNoteHidden), []);
  const commit = health.data?.commit ?? "";
  // Release builds carry the full commit hash; local builds a placeholder.
  const shortCommit = /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 12) : "";
  return (
    <div className="about-panel">
      <div className="about-version">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <div>
          <h3>HomeGrid {health.data?.version ?? ""}</h3>
          <p>
            {health.isPending
              ? "Reading version…"
              : health.error
                ? "Version information is unavailable."
                : shortCommit
                  ? `Build ${shortCommit}`
                  : "Local build"}
          </p>
        </div>
      </div>
      <p className="about-lead">
        A self-hosted homepage for your homelab. HomeGrid sends no telemetry and
        contacts your services only to fetch a logo you ask for and, if you turn
        it on, to check whether they are online; the links below open in a new
        tab.
      </p>
      {proxy && (
        <p className="proxy-hint" role="note">
          This page reached HomeGrid through a proxy at <code>{proxy}</code>{" "}
          that is not listed in <code>HOMEGRID_TRUSTED_PROXIES</code>. Sign-in
          rate limits then count every visitor as that proxy. If you control it,
          add its address to <code>HOMEGRID_TRUSTED_PROXIES</code>.
        </p>
      )}
      <ul className="about-links">
        {links.map(({ label, hint, href, Icon }) => (
          <li key={label}>
            <a href={href} target="_blank" rel="noopener noreferrer">
              <Icon size={18} />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <section className="about-support" aria-labelledby="about-support-title">
        <h4 id="about-support-title">
          <Heart size={16} aria-hidden="true" fill="currentColor" />
          Support HomeGrid
        </h4>
        <p className="about-lead">
          HomeGrid is free and open source, made for the homelab community. If
          it is useful to you, a donation helps keep it maintained.
        </p>
        <ul className="about-links">
          {donations.map(({ label, hint, href }) => (
            <li key={label}>
              <a href={href} target="_blank" rel="noopener noreferrer">
                <Heart size={18} />
                <span>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
        {noteHidden && (
          <button
            type="button"
            className="text-button"
            onClick={() => setCreditsHidden(false)}
          >
            Show the HomeGrid note below the dashboard again
          </button>
        )}
      </section>
    </div>
  );
}
