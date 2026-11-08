import { useEffect, useState } from "react";
import {
  BookOpen,
  Bug,
  ExternalLink,
  Code,
  Globe,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { api } from "./lib";

const repository = "https://github.com/bifrost0x/homegrid";
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
        contacts your services only to fetch a logo you ask for; the links below
        open in a new tab.
      </p>
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
    </div>
  );
}
