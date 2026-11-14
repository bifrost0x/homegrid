/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import manifestSource from "../public/manifest.webmanifest?raw";
import html from "../index.html?raw";

const icons = Object.keys(
  import.meta.glob("../public/icons/*.png", { query: "?url" }),
).map((path) => path.replace("../public", ""));

describe("installable web app", () => {
  const manifest = JSON.parse(manifestSource) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it("opens the dashboard as a standalone app", () => {
    expect(manifest.name).toBe("HomeGrid");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("ships the icons that browsers require for installation", () => {
    const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
    expect(sizes).toEqual(
      expect.arrayContaining([
        "192x192:any",
        "512x512:any",
        "512x512:maskable",
      ]),
    );
    for (const icon of manifest.icons) expect(icons).toContain(icon.src);
  });

  it("links the manifest and icons from the page", () => {
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain(
      'rel="apple-touch-icon" href="/icons/apple-touch-icon.png"',
    );
    expect(html).toContain('rel="icon" href="/favicon.svg"');
    expect(icons).toContain("/icons/apple-touch-icon.png");
  });
});
