import { it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./Settings";
import { defaults } from "./lib";
afterEach(() => vi.unstubAllGlobals());
it("saves appearance choices", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" }));
});
it("invalid replacement files invalidate the previous import approval", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ apps: 0, categories: 1, duplicates: 0 })),
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
  const backup = JSON.stringify({
    version: 1,
    apps: [],
    categories: [{ id: 1, name: "General", sort_order: 0, collapsed: false }],
    settings: defaults,
  });
  const valid = new File([backup], "valid.json", { type: "application/json" });
  Object.defineProperty(valid, "text", { value: async () => backup });
  await userEvent.upload(screen.getByLabelText("Import configuration"), valid);
  await screen.findByRole("button", { name: "Apply import" });
  await userEvent.selectOptions(
    screen.getByLabelText("Import mode"),
    "replace",
  );
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: /current configuration will be replaced/,
    }),
  );
  expect(screen.getByRole("button", { name: "Apply import" })).toBeEnabled();
  const invalid = new File(["{broken"], "invalid.json", {
    type: "application/json",
  });
  Object.defineProperty(invalid, "text", { value: async () => "{broken" });
  await userEvent.upload(
    screen.getByLabelText("Import configuration"),
    invalid,
  );
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("button", { name: "Apply import" }),
  ).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  await userEvent.upload(screen.getByLabelText("Import configuration"), valid);
  expect(
    await screen.findByRole("button", { name: "Apply import" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("checkbox", {
      name: /current configuration will be replaced/,
    }),
  ).not.toBeChecked();
  expect(fetch).toHaveBeenCalledTimes(2);
});
