import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./Settings";
import { defaults } from "./lib";
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
