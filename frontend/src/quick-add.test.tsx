import { it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationForm } from "./ApplicationForm";
import { duplicateName, type Application } from "./lib";
import { serviceTemplates, findIcons } from "./catalog";
import { serviceIcons } from "./serviceIcons";
import { defaults } from "./lib";
import { App } from "./App";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const category = { id: 1, name: "General", sort_order: 0, collapsed: false };
const app: Application = {
  id: 1,
  name: "Cinema",
  url: "https://media.home",
  description: "Family films",
  icon: "builtin:film",
  icon_color: "violet",
  favorite: true,
  category_id: 1,
  sort_order: 0,
  open_in_new_tab: false,
};
afterEach(() => vi.unstubAllGlobals());
it("associates visible helper text as descriptions while keeping visible labels in accessible names", async () => {
  render(
    <ApplicationForm
      categories={[category]}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  const chooser = screen.getByRole("button", { name: "Choose a service" });
  expect(chooser).toHaveAccessibleDescription(
    "Start with a template, or enter your details below.",
  );
  expect(chooser).toHaveTextContent("Choose a service");
  await userEvent.click(chooser);
  await userEvent.type(
    screen.getByLabelText("Search service templates"),
    "jellyfin",
  );
  const template = screen.getByRole("button", {
    name: "Use Jellyfin template",
  });
  expect(template).toHaveAccessibleDescription(
    "Media · Your films, series, and home videos.",
  );
  expect(template).toHaveTextContent("Jellyfin");
  expect(template).not.toHaveTextContent(
    "Your films, series, and home videos.",
  );
  expect(
    screen.getByText("Media · Your films, series, and home videos."),
  ).toBeVisible();
});
it("waits for URL blur before previewing an automatic favicon and rejects credentials", async () => {
  render(
    <ApplicationForm
      categories={[category]}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  const url = screen.getByLabelText("Application URL");
  await userEvent.type(url, "https://media.home");
  expect(document.querySelector(".icon-preview img")).toBeNull();
  await userEvent.tab();
  expect(document.querySelector(".icon-preview img")).toHaveAttribute(
    "src",
    "https://media.home/favicon.ico",
  );
  await userEvent.clear(url);
  await userEvent.type(url, "https://photos.home");
  expect(document.querySelector(".icon-preview img")).toHaveAttribute(
    "src",
    "https://media.home/favicon.ico",
  );
  await userEvent.tab();
  expect(document.querySelector(".icon-preview img")).toHaveAttribute(
    "src",
    "https://photos.home/favicon.ico",
  );
  await userEvent.clear(url);
  await userEvent.type(url, "https://owner:password@private.home");
  await userEvent.tab();
  expect(document.querySelector(".icon-preview img")).toBeNull();
});
it("opens the card duplicate control as a create dialog and waits for explicit save", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  let stored = [app];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/apps" && init?.method === "POST") {
      const copy = { ...JSON.parse(String(init.body)), id: 2, sort_order: 1 };
      stored = [app, copy];
      return new Response(JSON.stringify(copy));
    }
    return new Response(
      JSON.stringify(
        path === "/api/auth/session"
          ? {
              authenticated: true,
              setup_required: false,
              username: "owner",
              csrf_token: "token",
            }
          : path === "/api/apps"
            ? stored
            : path === "/api/categories"
              ? [category]
              : defaults,
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
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
    await screen.findByRole("button", { name: "More actions for Cinema" }),
  );
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Duplicate Cinema" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Duplicate application" });
  expect(await within(dialog).findByLabelText("Application name")).toHaveValue(
    "Cinema copy",
  );
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Add application" }),
  );
  await screen.findByRole("button", {
    name: "More actions for Cinema copy",
  });
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  expect(stored[1]).toEqual(
    expect.objectContaining({
      name: "Cinema copy",
      icon_color: "violet",
      favorite: true,
    }),
  );
});
it("offers one icon toolbar tab stop and keyboard navigation plus selection", async () => {
  render(
    <ApplicationForm
      app={app}
      categories={[category]}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  const toolbar = screen.getByRole("toolbar", { name: "Bundled icons" });
  expect(toolbar.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  const film = within(toolbar).getByRole("button", { name: "Use film icon" });
  film.focus();
  await userEvent.keyboard("{ArrowRight}");
  const music = within(toolbar).getByRole("button", { name: "Use music icon" });
  expect(music).toHaveFocus();
  await userEvent.keyboard(" ");
  expect(music).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{End}");
  const bookmark = within(toolbar).getByRole("button", {
    name: "Use " + Object.values(serviceIcons).at(-1)!.name + " service icon",
  });
  expect(bookmark).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(bookmark).toHaveAttribute("aria-pressed", "true");
  expect(toolbar.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  await userEvent.type(screen.getByLabelText("Search icons"), "surveillance");
  expect(
    within(toolbar).getByRole("button", { name: "Use camera icon" }),
  ).toHaveAttribute("tabindex", "0");
});
it("keeps manual entry immediate and prefills editable template details without inventing a URL", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const save = vi.fn(async () => {});
  render(
    <ApplicationForm
      categories={[category]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  expect(screen.getByLabelText("Application name")).toBeVisible();
  expect(screen.getByLabelText("Application URL")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Choose a service" }),
  );
  await userEvent.type(
    screen.getByLabelText("Search service templates"),
    "jellyfin",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Use Jellyfin template" }),
  );
  expect(screen.getByLabelText("Application name")).toHaveValue("Jellyfin");
  expect(screen.getByLabelText("Application URL")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Use violet icon color" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Add application" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("URL");
  expect(save).not.toHaveBeenCalled();
  await userEvent.type(
    screen.getByLabelText("Application URL"),
    "https://my-jellyfin.home",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Add application" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Jellyfin",
      url: "https://my-jellyfin.home",
      icon: "service:jellyfin",
      icon_color: "violet",
      favorite: false,
    }),
    "Media",
  );
});
it("suggests a name only for a blank create field and a valid HTTP URL", async () => {
  render(
    <ApplicationForm
      categories={[category]}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  const url = screen.getByLabelText("Application URL"),
    name = screen.getByLabelText("Application name");
  await userEvent.type(url, "javascript:alert(1)");
  await userEvent.click(name);
  expect(name).toHaveValue("");
  await userEvent.clear(url);
  await userEvent.type(url, "https://jellyfin.home:8096");
  await userEvent.click(name);
  expect(name).toHaveValue("Jellyfin");
  await userEvent.clear(name);
  await userEvent.type(name, "My cinema");
  await userEvent.clear(url);
  await userEvent.type(url, "https://plex.home");
  await userEvent.click(name);
  expect(name).toHaveValue("My cinema");
});
it("never derives a replacement name in edit mode and preserves tint plus favorite", async () => {
  const save = vi.fn(async () => {});
  render(
    <ApplicationForm
      app={app}
      categories={[category]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  const name = screen.getByLabelText("Application name");
  await userEvent.clear(name);
  await userEvent.click(screen.getByLabelText("Application URL"));
  await userEvent.tab();
  expect(name).toHaveValue("");
  await userEvent.type(name, "Renamed cinema");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ favorite: true, icon_color: "violet" }),
  );
});
it("searches keyword aliases and applies an icon color with keyboard input", async () => {
  render(
    <ApplicationForm
      app={app}
      categories={[category]}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  await userEvent.type(screen.getByLabelText("Search icons"), "surveillance");
  expect(screen.getByRole("button", { name: "Use camera icon" })).toBeVisible();
  const blue = within(
    screen.getByRole("group", { name: "Icon color" }),
  ).getByRole("button", { name: "Use blue icon color" });
  blue.focus();
  await userEvent.keyboard("{Enter}");
  expect(blue).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector(".icon-preview .app-icon")).toHaveAttribute(
    "data-icon-color",
    "blue",
  );
});
it("duplicates into an unsaved create form with preserved editable preferences", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const save = vi.fn(async () => {});
  render(
    <ApplicationForm
      duplicate={app}
      categories={[category]}
      onSave={save}
      onClose={() => {}}
    />,
  );
  expect(screen.getByLabelText("Application name")).toHaveValue("Cinema copy");
  expect(screen.getByLabelText("Application URL")).toHaveValue(app.url);
  expect(screen.getByLabelText("Open in a new tab")).not.toBeChecked();
  expect(fetch).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Add application" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Cinema copy",
      url: app.url,
      category_id: 1,
      icon: "builtin:film",
      icon_color: "violet",
      favorite: true,
      open_in_new_tab: false,
    }),
  );
});
it("has at least24 URL-free templates and44 local icons, and creates valid UTF-8 copy names", () => {
  expect(serviceTemplates.length).toBeGreaterThanOrEqual(24);
  expect(serviceTemplates.every((t) => !("url" in t))).toBe(true);
  expect(findIcons("")).toHaveLength(44);
  expect(findIcons("docker").map(([id]) => id)).toContain("container");
  const name = duplicateName("🧑🏽‍💻".repeat(12));
  expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(100);
  expect(name.endsWith(" copy")).toBe(true);
  expect(name).not.toContain("\uFFFD");
});
