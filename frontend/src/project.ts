import { emit } from "./events";

/** Public project addresses; links open in a new tab and send nothing. */
export const repository = "https://github.com/bifrost0x/homegrid";

/** Donation pages, matching .github/FUNDING.yml. */
export const donations = [
  {
    label: "GitHub Sponsors",
    hint: "Monthly or one-time support",
    href: "https://github.com/sponsors/bifrost0x",
  },
  {
    label: "Buy Me a Coffee",
    hint: "A one-time thank you",
    href: "https://buymeacoffee.com/bifrost0x",
  },
  {
    label: "Patreon",
    hint: "Ongoing membership",
    href: "https://www.patreon.com/bifrost0x",
  },
] as const;

const creditsKey = "homegrid:credits-hidden";

/** Whether this browser hid the HomeGrid note below the dashboard. */
export function creditsHidden() {
  try {
    return localStorage.getItem(creditsKey) === "1";
  } catch {
    return false;
  }
}

export function setCreditsHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(creditsKey, "1");
    else localStorage.removeItem(creditsKey);
  } catch {
    /* Storage can be unavailable; the choice then lasts for this page only. */
  }
  emit("homegrid:credits-changed", hidden);
}
