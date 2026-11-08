import { it, expect, vi, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationForm } from "./ApplicationForm";
import { SettingsPanel } from "./Settings";
import { PasswordForm } from "./Account";
import { defaults, filterApps } from "./lib";
import { App } from "./App";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const category = {
  id: 1,
  name: "Infrastructure",
  sort_order: 0,
  collapsed: false,
};
const app = {
  id: 1,
  name: "Atlas",
  url: "https://atlas.home",
  description: "Files and backups",
  category_id: 1,
  icon: "builtin:server",
  sort_order: 0,
  open_in_new_tab: true,
  favorite: true,
  icon_color: "auto" as const,
};
afterEach(() => vi.unstubAllGlobals());
it("clears cached private launcher data after signing out", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  let authenticated = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/logout") {
        authenticated = false;
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify(
          path === "/api/auth/session"
            ? {
                authenticated,
                setup_required: false,
                username: authenticated ? "owner" : "",
                csrf_token: "token",
              }
            : path === "/api/apps"
              ? [app]
              : path === "/api/categories"
                ? [category]
                : defaults,
        ),
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Remove Atlas from favorites" });
  expect(client.getQueryData(["apps"])).toEqual([app]);
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByLabelText("Username");
  await waitFor(() => {
    for (const key of ["apps", "categories", "settings"])
      expect(client.getQueryData([key])).toBeUndefined();
  });
});
it("favorites are reversible and organizing controls are deliberately revealed", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  let stored = { ...app, favorite: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/auth/session")
        return new Response(
          JSON.stringify({
            authenticated: true,
            setup_required: false,
            username: "owner",
            csrf_token: "token",
          }),
        );
      if (path === "/api/apps/1" && init?.method === "PATCH") {
        stored = { ...stored, ...JSON.parse(String(init.body)) };
        return new Response(JSON.stringify(stored));
      }
      return new Response(
        JSON.stringify(
          path === "/api/apps"
            ? [stored]
            : path === "/api/categories"
              ? [category]
              : defaults,
        ),
      );
    }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Add Atlas to favorites" }),
  );
  const favorites = await screen.findByRole("region", { name: "Favorites" });
  expect(
    within(favorites).getByRole("link", { name: "Open favorite Atlas" }),
  ).toHaveAttribute("href", app.url);
  expect(screen.getAllByTestId("application-card")).toHaveLength(1);
  await userEvent.click(
    await screen.findByRole("button", { name: "Remove Atlas from favorites" }),
  );
  await screen.findByRole("button", { name: "Add Atlas to favorites" });
  expect(
    screen.queryByRole("region", { name: "Favorites" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Drag Atlas" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Organize" }));
  expect(
    screen.getByRole("button", { name: "Done organizing" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Drag Atlas" })).toBeVisible();
  expect(screen.getByRole("button", { name: "New category" })).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Done organizing" }),
  );
  expect(
    screen.queryByRole("button", { name: "Drag Atlas" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "More actions for Atlas" }),
  ).toBeVisible();
});
it("rejects short new passwords and keeps the form ready to correct", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<PasswordForm />);
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "Current-password",
  );
  await userEvent.type(screen.getByLabelText("New password"), "short");
  await userEvent.type(screen.getByLabelText("Confirm new password"), "short");
  await userEvent.click(
    screen.getByRole("button", { name: "Change password" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("at least 12");
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Current password")).toHaveValue(
    "Current-password",
  );
});
it("shows an incorrect current password error without losing the entered values", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "validation",
              message: "Current password is incorrect.",
            },
          }),
          { status: 400 },
        ),
    ),
  );
  render(<PasswordForm />);
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "Wrong-password",
  );
  await userEvent.type(
    screen.getByLabelText("New password"),
    "New-password-2026",
  );
  await userEvent.type(
    screen.getByLabelText("Confirm new password"),
    "New-password-2026",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Change password" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Current password is incorrect",
  );
  expect(screen.getByLabelText("New password")).toHaveValue(
    "New-password-2026",
  );
});
it("preserves a favorite while editing ordinary app fields", async () => {
  const save = vi.fn(async () => {});
  render(
    <ApplicationForm
      app={app}
      categories={[category]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ favorite: true }),
  );
});
it("matches words across fields and ranks names before descriptions, then favorites", () => {
  const apps = [
    { ...app, id: 1, name: "Other", favorite: false },
    { ...app, id: 2, name: "Backups", description: "Files", favorite: false },
    {
      ...app,
      id: 3,
      name: "Backups Pro",
      description: "Files",
      favorite: true,
      icon_color: "auto" as const,
    },
  ];
  expect(
    filterApps(apps, [category], "files infrastructure").map((a) => a.id),
  ).toEqual([3, 1, 2]);
  expect(filterApps(apps, [category], "backups").map((a) => a.id)).toEqual([
    3, 2, 1,
  ]);
  expect(filterApps(apps, [category], "files missing")).toEqual([]);
});
it("switches settings tabs with keyboard navigation", async () => {
  render(
    <SettingsPanel
      settings={defaults}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  const appearance = screen.getByRole("tab", { name: "Appearance" });
  await userEvent.click(appearance);
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Layout" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByLabelText("Dashboard width")).toBeVisible();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Backup" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "Export configuration" }),
  ).toBeVisible();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Account" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByLabelText("Current password")).toBeVisible();
});
it("rejects mismatched password confirmation without sending a request", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<PasswordForm />);
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "Current-password",
  );
  await userEvent.type(
    screen.getByLabelText("New password"),
    "New-password-2026",
  );
  await userEvent.type(
    screen.getByLabelText("Confirm new password"),
    "Different-password",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Change password" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("match");
  expect(fetch).not.toHaveBeenCalled();
});
it("updates session state after changing a password", async () => {
  const session = {
    authenticated: true,
    setup_required: false,
    username: "owner",
    csrf_token: "rotated-token",
  };
  const fetch = vi.fn(async () => new Response(JSON.stringify(session)));
  vi.stubGlobal("fetch", fetch);
  const changed = vi.fn();
  window.addEventListener("homegrid:session-refreshed", changed);
  render(<PasswordForm />);
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "Current-password",
  );
  await userEvent.type(
    screen.getByLabelText("New password"),
    "New-password-2026",
  );
  await userEvent.type(
    screen.getByLabelText("Confirm new password"),
    "New-password-2026",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Change password" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Password changed",
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(
    "/api/auth/password",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        current_password: "Current-password",
        new_password: "New-password-2026",
      }),
    }),
  );
  window.removeEventListener("homegrid:session-refreshed", changed);
});
