import { it, expect, vi, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./Settings";
import { defaults } from "./lib";
afterEach(() => vi.unstubAllGlobals());
it("previews a chosen background locally and never uploads a cancelled draft", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const save = vi.fn(async () => {});
  render(
    <SettingsPanel settings={defaults} onSave={save} onClose={() => {}} />,
  );
  const file = new File(["image"], "background.png", { type: "image/png" });
  await userEvent.click(screen.getByRole("radio", { name: "Your image" }));
  await userEvent.upload(screen.getByLabelText("Choose image"), file);
  const preview = screen.getByRole("region", { name: "Appearance preview" });
  await waitFor(() =>
    expect(
      preview.querySelector(".preview-background")?.getAttribute("style"),
    ).toContain("data:image/png;base64"),
  );
  await userEvent.click(screen.getByLabelText("Subtle background blur"));
  expect(preview).toHaveClass("blurred");
  await userEvent.click(screen.getByRole("button", { name: "Discard and close" }));
  expect(fetch).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it("previews draft appearance and real application content without writing until save", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const save = vi.fn(async () => {}),
    close = vi.fn();
  render(
    <SettingsPanel
      settings={defaults}
      previewApp={{
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
      }}
      onSave={save}
      onClose={close}
    />,
  );
  const preview = screen.getByRole("region", { name: "Appearance preview" });
  expect(within(preview).getByText("Atlas")).toBeVisible();
  expect(within(preview).queryByRole("link")).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText("Dashboard title"));
  await userEvent.type(
    screen.getByLabelText("Dashboard title"),
    "My quiet corner",
  );
  await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
  await userEvent.click(screen.getByRole("radio", { name: "Compact" }));
  await userEvent.click(screen.getByRole("radio", { name: "Square" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Use blue accent" }),
  );
  await userEvent.click(screen.getByLabelText("Show application descriptions"));
  expect(
    within(preview).getByRole("heading", { name: "My quiet corner" }),
  ).toBeVisible();
  expect(preview).toHaveAttribute("data-theme", "dark");
  expect(preview).toHaveAttribute("data-accent", "blue");
  expect(preview).toHaveClass("compact", "square");
  expect(
    within(preview).queryByText("Files and backups"),
  ).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("tab", { name: "Backup" }));
  await userEvent.click(screen.getByRole("tab", { name: "Appearance" }));
  expect(screen.getByLabelText("Dashboard title")).toHaveValue(
    "My quiet corner",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "My quiet corner",
      theme: "dark",
      accent: "blue",
      density: "compact",
      radius: "square",
      show_descriptions: false,
    }),
  );
});
it("allows keyboard accent selection and closes without saving draft changes", async () => {
  const save = vi.fn(async () => {}),
    close = vi.fn();
  render(<SettingsPanel settings={defaults} onSave={save} onClose={close} />);
  const swatch = screen.getByRole("button", { name: "Use rose accent" });
  swatch.focus();
  await userEvent.keyboard("{Enter}");
  expect(swatch).toHaveAttribute("aria-pressed", "true");
  expect(
    within(screen.getByRole("group", { name: "Accent color" })).getByRole(
      "button",
      { name: "Use rose accent" },
    ),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("region", { name: "Appearance preview" }),
  ).toHaveTextContent("Example application");
  await userEvent.click(screen.getByRole("button", { name: "Discard and close" }));
  expect(close).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
});
