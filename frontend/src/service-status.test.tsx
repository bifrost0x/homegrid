import { afterEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { SettingsPanel } from "./Settings";
import { defaults, type Application } from "./lib";

afterEach(() => vi.unstubAllGlobals());

const app = (id: number, name: string): Application => ({
  id,
  name,
  url: `https://${name.toLowerCase()}.home.arpa`,
  description: "",
  icon: "builtin:server",
  category_id: 1,
  sort_order: id,
  open_in_new_tab: true,
  favorite: false,
  icon_color: "auto",
});

function setup(statusChecks: boolean) {
  const requested: string[] = [];
  const background: string[] = [];
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = String(url).replace("/api", "");
    requested.push(path);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers["X-HomeGrid-Background"] === "1") background.push(path);
    const data =
      path === "/auth/session"
        ? { authenticated: true, username: "owner", csrf_token: "token" }
        : path === "/apps"
          ? [app(1, "Atlas"), app(2, "Beacon"), app(3, "Comet")]
          : path === "/categories"
            ? [{ id: 1, name: "General", sort_order: 0, collapsed: false }]
            : path === "/settings"
              ? { ...defaults, status_checks: statusChecks }
              : path === "/status"
                ? {
                    enabled: true,
                    statuses: { "1": "up", "2": "down", "3": "unknown" },
                  }
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
  return { requested, background };
}

it("shows each application's status when status checks are enabled", async () => {
  const { background } = setup(true);
  const atlas = await screen.findByRole("link", { name: /Atlas, Online/ });
  expect(within(atlas).getByTitle("Online")).toHaveClass("status-dot", "up");
  expect(
    await screen.findByRole("link", { name: /Beacon, Offline/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Comet, Status unknown/ }),
  ).toBeInTheDocument();
  // Polls are marked so they do not keep an unattended session alive.
  expect(background).toContain("/status");
  expect(background).not.toContain("/apps");
});

it("never requests status while status checks are disabled", async () => {
  const { requested } = setup(false);
  await screen.findByRole("link", { name: /Atlas/ });
  expect(requested).not.toContain("/status");
  expect(document.querySelector(".status-dot")).toBeNull();
});

it("turns status checks on from the layout settings", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Layout" }));
  const toggle = screen.getByRole("checkbox", {
    name: "Show whether services are online",
  });
  expect(toggle).not.toBeChecked();
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole("button", { name: "Save layout" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ status_checks: true }),
  );
});
