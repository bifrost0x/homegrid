import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { convertForeignConfig, parseConfiguration } from "./foreignImport";
import { SettingsPanel } from "./Settings";
import { defaults } from "./lib";

afterEach(() => vi.unstubAllGlobals());

const homepage = `
- Media:
    - Jellyfin:
        href: https://jellyfin.home.arpa
        description: Films and series
        icon: jellyfin.png
    - Sonarr:
        href: "{{HOMEPAGE_VAR_SONARR_URL}}"
        widget:
          type: sonarr
    - Downloads:
        - qBittorrent:
            href: http://192.168.1.20:8080
- Developer:
    - Gitea:
        - abbr: GT
          href: https://git.home.arpa/
    - Docs:
        - href: https://docs.home.arpa
`;

const homer = `
title: Lab
services:
  - name: Infrastructure
    items:
      - name: Proxmox
        subtitle: Hypervisor
        url: https://pve.home.arpa:8006
        logo: assets/tools/proxmox.png
      - name: Broken
        url: javascript:alert(1)
  - name: Empty
`;

const dashy = `
pageInfo:
  title: Home
sections:
  - name: Monitoring
    items:
      - title: Grafana
        description: Dashboards
        url: https://grafana.home.arpa
        icon: hl-grafana
      - title: Credentials
        url: https://admin:secret@router.home.arpa
`;

describe("foreign dashboard configurations", () => {
  it("converts Homepage services, nested groups and bookmarks", async () => {
    const result = await parseConfiguration(homepage, "services.yaml");
    expect(result.format).toBe("Homepage");
    expect(result.data).toEqual({
      apps: [
        {
          name: "Jellyfin",
          url: "https://jellyfin.home.arpa/",
          category: "Media",
          icon: "",
          description: "Films and series",
        },
        {
          name: "qBittorrent",
          url: "http://192.168.1.20:8080/",
          category: "Downloads",
          icon: "",
          description: "",
        },
        {
          name: "Gitea",
          url: "https://git.home.arpa/",
          category: "Developer",
          icon: "",
          description: "",
        },
        {
          name: "Docs",
          url: "https://docs.home.arpa/",
          category: "Developer",
          icon: "",
          description: "",
        },
      ],
    });
    // The templated Sonarr link cannot be resolved outside Homepage.
    expect(result.skipped).toBe(1);
  });

  it("converts Homer services and skips non-HTTP links", async () => {
    const result = await parseConfiguration(homer, "config.yml");
    expect(result.format).toBe("Homer");
    expect(result.data).toEqual({
      apps: [
        {
          name: "Proxmox",
          url: "https://pve.home.arpa:8006/",
          category: "Infrastructure",
          icon: "",
          description: "Hypervisor",
        },
      ],
    });
    expect(result.skipped).toBe(2);
  });

  it("converts Dashy sections and refuses links with credentials", async () => {
    const result = await parseConfiguration(dashy, "conf.yml");
    expect(result.format).toBe("Dashy");
    expect(result.data).toEqual({
      apps: [
        {
          name: "Grafana",
          url: "https://grafana.home.arpa/",
          category: "Monitoring",
          icon: "",
          description: "Dashboards",
        },
      ],
    });
    expect(result.skipped).toBe(1);
  });

  it("keeps JSON backups on their existing path", async () => {
    const result = await parseConfiguration('{"version":1}', "backup.json");
    expect(result).toEqual({ data: { version: 1 }, skipped: 0 });
    await expect(parseConfiguration("{broken", "backup.json")).rejects.toThrow(
      SyntaxError,
    );
  });

  it("rejects unknown, invalid and empty configurations", async () => {
    await expect(parseConfiguration("title: Only", "x.yml")).rejects.toThrow(
      /Homepage, Homer or Dashy/,
    );
    await expect(parseConfiguration("a: [unclosed", "x.yml")).rejects.toThrow(
      /not valid JSON or YAML/,
    );
    expect(() => convertForeignConfig({ sections: [] })).toThrow(
      /no applications/,
    );
  });

  it("bounds alias expansion", async () => {
    const aliases = Array.from({ length: 150 }, () => "  - *a").join("\n");
    await expect(
      parseConfiguration(`base: &a [1]\nsections:\n${aliases}\n`, "x.yml"),
    ).rejects.toThrow(/not valid JSON or YAML/);
  });

  it("clips names, categories and descriptions to the server limits", () => {
    const result = convertForeignConfig({
      sections: [
        {
          name: "é".repeat(60),
          items: [
            {
              title: "ü".repeat(80),
              url: "https://nas.home.arpa",
              description: "x".repeat(600),
            },
            { url: "https://unnamed.home.arpa" },
          ],
        },
      ],
    })!;
    const [app, unnamed] = (result.data as { apps: Record<string, string>[] })
      .apps;
    const bytes = (value: string) => new TextEncoder().encode(value).length;
    expect(bytes(app.name)).toBeLessThanOrEqual(100);
    expect(bytes(app.category)).toBeLessThanOrEqual(80);
    expect(bytes(app.description)).toBe(500);
    expect(unnamed.name).toBe("unnamed.home.arpa");
  });
});

it("previews a Homer configuration through the existing import", async () => {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ apps: 1, categories: 2, duplicates: 0 })),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <SettingsPanel
      settings={defaults}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Backup" }));
  const file = new File([homer], "config.yml", { type: "" });
  Object.defineProperty(file, "text", { value: async () => homer });
  await userEvent.upload(screen.getByLabelText("Import configuration"), file);
  await screen.findByRole("button", { name: "Apply import" });
  expect(
    screen.getByText(
      /Homer configuration · 2 entries without an HTTP or HTTPS link skipped/,
    ),
  ).toBeInTheDocument();
  const [url, init] = fetch.mock.calls[0];
  expect(url).toContain("/import/preview");
  const body = JSON.parse(String(init?.body)) as {
    apps: { name: string; icon: string }[];
  };
  expect(body.apps).toHaveLength(1);
  expect(body.apps[0].name).toBe("Proxmox");
  // Proxmox is a bundled logo, so the import recognizes it.
  expect(body.apps[0].icon).toMatch(/^service:/);
});
