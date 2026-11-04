import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./Settings";
import { defaults, api } from "./lib";

it("cancel returns the preview to the latest saved settings without another write", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Use Forest design" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Use Dune design" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
  expect(
    screen.getByRole("region", { name: "Appearance preview" }),
  ).toHaveAttribute("data-design", "forest");
  expect(save).toHaveBeenCalledTimes(1);
});

it("announces a server undo token only after a successful mutation", async () => {
  const listener = vi.fn();
  window.addEventListener("homegrid:undo-available", listener);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(null, {
          status: 204,
          headers: { "X-HomeGrid-Undo": "persisted-token" },
        }),
    ),
  );
  try {
    await api("/apps/1", "DELETE");
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("homegrid:undo-available", listener);
    vi.unstubAllGlobals();
  }
});
