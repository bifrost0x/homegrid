import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { defaults, type Application } from "./lib";
import { detectService } from "./serviceDetection";
import { findLogoSuggestions } from "./dashboard/useLogoSuggestions";
import { recognizeImportedLogos } from "./importLogos";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const base: Application = {
  id: 1,
  name: "Media",
  url: "https://jellyfin.home.lan",
  description: "",
  icon: "favicon",
  category_id: 1,
  sort_order: 0,
  open_in_new_tab: true,
  favorite: false,
  icon_color: "auto",
};
const app = (patch: Partial<Application>): Application => ({
  ...base,
  ...patch,
});

describe("logo suggestions for existing applications", () => {
  it("offers logos only where an icon may be replaced", () => {
    const suggestions = findLogoSuggestions(
      [
        app({ id: 1, icon: "favicon" }),
        app({ id: 2, icon: "", url: "https://pve.lan:8006", name: "Host" }),
        app({ id: 3, icon: "builtin:film", name: "Plex" }),
        app({ id: 4, icon: "/uploads/" + "a".repeat(64) + ".png" }),
        app({ id: 5, icon: "service:jellyfin" }),
        app({ id: 6, url: "https://example.homegrid.invalid/jellyfin" }),
        app({ id: 7, name: "Notes", url: "https://192.168.1.10:8080" }),
      ],
      detectService,
    );
    expect(
      suggestions.map((s) => [s.app.id, s.service.id, s.recommended]),
    ).toEqual([
      [1, "jellyfin", true],
      [2, "proxmox", true],
      [3, "plex", false],
    ]);
  });
});

describe("logo recognition during import", () => {
  it("fills missing icons in both formats and keeps chosen ones", () => {
    const simple = {
      apps: [
        { name: "Jellyfin", url: "https://media.lan" },
        { name: "Mine", url: "https://grafana.lan", icon: "builtin:chart" },
      ],
    };
    const result = recognizeImportedLogos(simple, detectService);
    expect(result.recognized).toBe(1);
    expect(result.data).toEqual({
      apps: [
        {
          name: "Jellyfin",
          url: "https://media.lan",
          icon: "service:jellyfin",
        },
        { name: "Mine", url: "https://grafana.lan", icon: "builtin:chart" },
      ],
    });
    expect(simple.apps[0]).not.toHaveProperty("icon");
    const backup = {
      version: 1,
      apps: [{ ...base, icon: "", url: "https://home.lan:8123", name: "x" }],
    };
    const restored = recognizeImportedLogos(backup, detectService);
    expect(restored.recognized).toBe(1);
    expect((restored.data as typeof backup).apps[0].icon).toBe(
      "service:homeassistant",
    );
  });
  it("passes anything else through for server validation", () => {
    for (const value of [null, [], "text", { apps: "x" }, { apps: [1, null] }])
      expect(recognizeImportedLogos(value, detectService)).toEqual({
        data: value,
        recognized: 0,
      });
  });
});

function mountDashboard(apps: Application[]) {
  const patches: { path: string; body: Application }[] = [];
  let current = apps.map((a) => ({ ...a }));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = String(url).replace("/api", "");
    if (init?.method === "PATCH" && path.startsWith("/apps/")) {
      const body = JSON.parse(String(init.body)) as Application;
      patches.push({ path, body });
      current = current.map((a) => (a.id === body.id ? body : a));
      return Response.json(body);
    }
    const data =
      path === "/auth/session"
        ? { authenticated: true, username: "owner", csrf_token: "token" }
        : path === "/apps"
          ? current
          : path === "/categories"
            ? [{ id: 1, name: "General", sort_order: 0, collapsed: false }]
            : path === "/settings"
              ? defaults
              : [];
    return Response.json(data);
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
  return patches;
}

it("suggests recognized logos and applies only the selected ones", async () => {
  const patches = mountDashboard([
    app({ id: 1, name: "Jellyfin", url: "https://media.lan" }),
    app({ id: 2, name: "Plex", url: "https://p.lan", icon: "builtin:film" }),
  ]);
  const banner = await screen.findByText(
    "HomeGrid recognized the logo for 1 application.",
  );
  expect(banner.closest("[role=status]")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Review logos" }));
  const dialog = screen.getByRole("dialog", { name: "Use recognized logos" });
  const boxes = within(dialog).getAllByRole("checkbox");
  expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([
    true,
    false,
  ]);
  expect(dialog).toHaveTextContent("replaces the icon you picked");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Use 1 logo" }),
  );
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toMatchObject({
    path: "/apps/1",
    body: { id: 1, name: "Jellyfin", icon: "service:jellyfin" },
  });
  await screen.findByText("Logo updated for 1 application.");
  expect(
    screen.queryByRole("dialog", { name: "Use recognized logos" }),
  ).not.toBeInTheDocument();
});

it("remembers a dismissed suggestion set", async () => {
  const apps = [app({ id: 1, name: "Jellyfin", url: "https://media.lan" })];
  mountDashboard(apps);
  await screen.findByRole("button", { name: "Review logos" });
  await userEvent.click(
    screen.getByRole("button", { name: "Dismiss logo suggestions" }),
  );
  expect(
    screen.queryByRole("button", { name: "Review logos" }),
  ).not.toBeInTheDocument();
  expect(localStorage.getItem("homegrid.logo-suggestions.dismissed")).toBe(
    "1:jellyfin",
  );
});
