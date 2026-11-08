import { it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./Settings";
import { defaults } from "./lib";

it("previews a complete design without saving and preserves the title", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel
      settings={{ ...defaults, title: "My home" }}
      onSave={save}
      onClose={() => {}}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Aurora preset" }),
  );
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Dashboard title")).toHaveValue("My home");
  expect(
    screen.getByRole("region", { name: "Appearance preview" }),
  ).toHaveAttribute("data-design", "aurora");
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      design: "aurora",
      wallpaper: "aurora",
      background: "",
      custom_accent: "",
    }),
  );
});

it("saves layout choices while retaining unsaved appearance edits", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Dune preset" }),
  );
  await userEvent.click(screen.getByRole("tab", { name: "Layout" }));
  await userEvent.selectOptions(
    screen.getByLabelText("Dashboard width"),
    "full",
  );
  await userEvent.selectOptions(screen.getByLabelText("Groups per row"), "3");
  await userEvent.selectOptions(
    screen.getByLabelText("Applications per row"),
    "6",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Application style"),
    "tiles",
  );
  await userEvent.click(screen.getByRole("button", { name: "Save layout" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      design: "dune",
      content_width: "full",
      group_columns: "3",
      columns: "6",
      card_style: "tiles",
    }),
  );
});

it("can remove a background independently and restore the preset", async () => {
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Forest preset" }),
  );
  await userEvent.click(screen.getByRole("radio", { name: "None" }));
  expect(
    within(
      screen.getByRole("region", { name: "Appearance preview" }),
    ).queryByTestId("preview-wallpaper"),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Forest preset" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ wallpaper: "forest" }),
  );
});
