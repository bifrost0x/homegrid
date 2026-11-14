import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./components";
import { SettingsPanel } from "./Settings";
import { defaults, webSearchUrl, type Application } from "./lib";

afterEach(() => vi.restoreAllMocks());

const category = { id: 1, name: "General", collapsed: false, sort_order: 0 };
const app: Application = {
  id: 1,
  name: "Cinema",
  url: "https://media.local",
  description: "Family movies",
  icon: "builtin:film",
  category_id: 1,
  sort_order: 0,
  open_in_new_tab: true,
  favorite: false,
  icon_color: "auto",
};

describe("web search addresses", () => {
  it("encodes the terms into the selected engine", () => {
    expect(
      webSearchUrl({ web_search: "duckduckgo", web_search_url: "" }, " a&b ?"),
    ).toBe("https://duckduckgo.com/?q=a%26b%20%3F");
    expect(
      webSearchUrl(
        {
          web_search: "custom",
          web_search_url: "https://searx.home.arpa/search?q=%s",
        },
        "homelab",
      ),
    ).toBe("https://searx.home.arpa/search?q=homelab");
  });
  it("offers nothing while off, for empty terms or unsafe templates", () => {
    expect(
      webSearchUrl({ web_search: "", web_search_url: "" }, "x"),
    ).toBeUndefined();
    expect(
      webSearchUrl({ web_search: "google", web_search_url: "" }, "  "),
    ).toBeUndefined();
    expect(
      webSearchUrl(
        { web_search: "custom", web_search_url: "javascript:alert(%s)" },
        "x",
      ),
    ).toBeUndefined();
    expect(
      webSearchUrl({ web_search: "custom", web_search_url: "" }, "x"),
    ).toBeUndefined();
  });
});

function palette(webSearch?: (query: string) => string | undefined) {
  const close = vi.fn();
  render(
    <CommandPalette
      apps={[app]}
      categories={[category]}
      onClose={close}
      webSearch={webSearch}
    />,
  );
  return close;
}

it("searches the web when no application matches", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const close = palette((q) =>
    webSearchUrl({ web_search: "brave", web_search_url: "" }, q),
  );
  await userEvent.type(screen.getByRole("combobox"), "proxmox backup");
  const option = screen.getByRole("option", {
    name: /Search the web for “proxmox backup”/,
  });
  expect(option).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByText("No applications found")).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  expect(open).toHaveBeenCalledWith(
    "https://search.brave.com/search?q=proxmox%20backup",
    "_blank",
    "noopener,noreferrer",
  );
  expect(close).toHaveBeenCalled();
});

it("lists the web search after matching applications", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  palette((q) =>
    webSearchUrl({ web_search: "duckduckgo", web_search_url: "" }, q),
  );
  const input = screen.getByRole("combobox");
  await userEvent.type(input, "cine");
  expect(screen.getAllByRole("option").map((o) => o.id)).toEqual([
    "result-1",
    "result-web",
  ]);
  expect(input).toHaveAttribute("aria-activedescendant", "result-1");
  await userEvent.keyboard("{ArrowDown}");
  expect(input).toHaveAttribute("aria-activedescendant", "result-web");
  await userEvent.keyboard("{Enter}");
  expect(open).toHaveBeenCalledWith(
    "https://duckduckgo.com/?q=cine",
    "_blank",
    "noopener,noreferrer",
  );
});

it("keeps the empty state while web search is off", async () => {
  palette();
  await userEvent.type(screen.getByRole("combobox"), "nothing");
  expect(screen.getByText("No applications found")).toBeInTheDocument();
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});

it("chooses a custom search address in the layout settings", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Layout" }));
  await userEvent.selectOptions(
    screen.getByLabelText("Web search in quick search"),
    "custom",
  );
  await userEvent.type(
    screen.getByLabelText("Search address"),
    "https://searx.home.arpa/search?q=%s",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save layout" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      web_search: "custom",
      web_search_url: "https://searx.home.arpa/search?q=%s",
    }),
  );
});
