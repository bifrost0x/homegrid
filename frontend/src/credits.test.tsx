import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { About } from "./About";
import { Credits } from "./dashboard/Credits";
import { CommandPalette } from "./components";
import { defaults, webSearchName } from "./lib";
import { setCreditsHidden } from "./project";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it("links the project and offers support until it is hidden", async () => {
  const support = vi.fn();
  render(<Credits onSupport={support} />);
  expect(screen.getByRole("link", { name: /HomeGrid/ })).toHaveAttribute(
    "href",
    "https://github.com/bifrost0x/homegrid",
  );
  expect(screen.getByRole("link", { name: /HomeGrid/ })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(screen.getByText(/for the homelab community/)).toHaveTextContent(
    "Made with love for the homelab community",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Support HomeGrid" }),
  );
  expect(support).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Hide this note" }));
  expect(screen.queryByText(/^Made with/)).not.toBeInTheDocument();
  expect(localStorage.getItem("homegrid:credits-hidden")).toBe("1");
});

it("stays hidden after a reload and can be restored from About", async () => {
  setCreditsHidden(true);
  vi.stubGlobal("fetch", async () =>
    Response.json({
      status: "ok",
      version: "1.2.3",
      commit: "local",
      untrusted_proxy: "",
    }),
  );
  render(
    <>
      <Credits onSupport={() => {}} />
      <About />
    </>,
  );
  expect(screen.queryByText(/^Made with/)).not.toBeInTheDocument();
  for (const name of ["GitHub Sponsors", "Buy Me a Coffee", "Patreon"])
    expect(
      screen.getByRole("link", { name: new RegExp(name) }),
    ).toHaveAttribute("target", "_blank");
  await userEvent.click(
    screen.getByRole("button", { name: /Show the HomeGrid note/ }),
  );
  expect(screen.getByText(/^Made with/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Show the HomeGrid note/ }),
  ).not.toBeInTheDocument();
});

it("works when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(<Credits onSupport={() => {}} />);
  act(() => setCreditsHidden(true));
  expect(screen.queryByText(/^Made with/)).not.toBeInTheDocument();
  vi.restoreAllMocks();
});

it("names the selected web search", () => {
  expect(webSearchName(defaults)).toBeUndefined();
  expect(webSearchName({ web_search: "duckduckgo", web_search_url: "" })).toBe(
    "DuckDuckGo",
  );
  expect(
    webSearchName({
      web_search: "custom",
      web_search_url: "https://searx.home.arpa/search?q=%s",
    }),
  ).toBe("searx.home.arpa");
  expect(
    webSearchName({ web_search: "custom", web_search_url: "" }),
  ).toBeUndefined();
  render(
    <CommandPalette
      apps={[]}
      categories={[]}
      onClose={() => {}}
      webSearchName="Brave Search"
    />,
  );
  expect(
    screen.getByText(/or browse the web via Brave Search\./),
  ).toBeInTheDocument();
});
