import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { About } from "./About";

afterEach(() => vi.unstubAllGlobals());

function mount(commit: string) {
  vi.stubGlobal("fetch", async () =>
    Response.json({ status: "ok", version: "1.2.3", commit }),
  );
  render(<About />);
}

it("shows the release version and a short build hash", async () => {
  mount("0123456789abcdef0123456789abcdef01234567");
  expect(
    await screen.findByRole("heading", { name: "HomeGrid 1.2.3" }),
  ).toBeVisible();
  expect(screen.getByText("Build 0123456789ab")).toBeVisible();
  const links = screen.getAllByRole("link");
  expect(links.length).toBeGreaterThan(3);
  for (const link of links) {
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.getAttribute("href")).toMatch(
      /^https:\/\/(github\.com\/bifrost0x\/homegrid|bifrost0x\.github\.io\/homegrid\/|github\.com\/sponsors\/bifrost0x$|buymeacoffee\.com\/bifrost0x$|www\.patreon\.com\/bifrost0x$)/,
    );
  }
});

it("labels local builds without inventing a hash", async () => {
  mount("local");
  expect(await screen.findByText("Local build")).toBeVisible();
});
