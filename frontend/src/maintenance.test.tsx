import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { About } from "./About";
import { UnusedUploads } from "./Maintenance";

afterEach(() => vi.unstubAllGlobals());

const name = "a".repeat(64) + ".png";

it("deletes unused images only after review and confirmation", async () => {
  const calls: { path: string; body?: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = String(url).replace("/api", "");
    calls.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (path === "/uploads/unused")
      return Response.json({
        files: [{ name, url: "/uploads/" + name, size: 2048 }],
      });
    return Response.json({ deleted: 1 });
  });
  render(<UnusedUploads />);
  await userEvent.click(
    screen.getByRole("button", { name: "Find unused images" }),
  );
  expect(await screen.findByText(/1 unused image · 2 KB/)).toBeVisible();
  expect(screen.getByRole("img", { name: /Unused image/ })).toHaveAttribute(
    "src",
    "/uploads/" + name,
  );
  const remove = screen.getByRole("button", { name: "Delete unused images" });
  expect(remove).toBeDisabled();
  await userEvent.click(
    screen.getByRole("checkbox", { name: /Permanently delete/ }),
  );
  await userEvent.click(remove);
  expect(await screen.findByText("Deleted 1 unused image.")).toBeVisible();
  expect(calls.at(-1)).toEqual({
    path: "/uploads/cleanup",
    body: { names: [name], confirm: true },
  });
});

it("reports when nothing is unused", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ files: [] }));
  render(<UnusedUploads />);
  await userEvent.click(
    screen.getByRole("button", { name: "Find unused images" }),
  );
  expect(await screen.findByText("No unused images found.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Delete unused images" }),
  ).not.toBeInTheDocument();
});

it("explains an untrusted reverse proxy in About", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    String(url).endsWith("/diagnostics")
      ? Response.json({ untrusted_proxy: "172.18.0.1" })
      : Response.json({ status: "ok", version: "1.2.3", commit: "local" }),
  );
  render(<About />);
  const note = await screen.findByRole("note");
  expect(note).toHaveTextContent("172.18.0.1");
  expect(note).toHaveTextContent("HOMEGRID_TRUSTED_PROXIES");
});
