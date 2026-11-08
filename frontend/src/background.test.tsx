import { afterEach, it, expect, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel } from "./Settings";
import { defaults } from "./lib";
const readers: ControlledReader[] = [];
class ControlledReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    readers.push(this);
  }
  readAsDataURL(_file: Blob) {}
}
function mount(background = "") {
  readers.length = 0;
  vi.stubGlobal("FileReader", ControlledReader);
  const save = vi.fn(async () => {});
  const view = render(
    <SettingsPanel
      settings={{ ...defaults, background }}
      onSave={save}
      onClose={() => {}}
    />,
  );
  return { ...view, save };
}
async function imageInput() {
  if (!screen.queryByLabelText("Choose image"))
    await userEvent.click(screen.getByRole("radio", { name: "Your image" }));
  return screen.getByLabelText("Choose image");
}
const choose = async (name: string) =>
  userEvent.upload(
    await imageInput(),
    new File([name], name + ".png", { type: "image/png" }),
  );
async function complete(index: number, name: string) {
  await act(async () => {
    readers[index].result = "data:image/png;base64," + name;
    readers[index].onload?.();
  });
}
afterEach(() => vi.unstubAllGlobals());
it("a design selection cancels an unfinished image and saves the selected wallpaper", async () => {
  const { save } = mount("/uploads/old.png");
  await choose("unfinished");
  await userEvent.click(
    screen.getByRole("button", { name: "Apply Aurora preset" }),
  );
  await complete(0, "unfinished");
  expect(
    screen.queryByAltText("Current dashboard background"),
  ).not.toBeInTheDocument();
  expect(
    screen
      .getByRole("region", { name: "Appearance preview" })
      .querySelector(".preview-background")
      ?.getAttribute("style"),
  ).toContain("/backgrounds/aurora.webp");
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      design: "aurora",
      background: "",
      wallpaper: "aurora",
    }),
  );
});
it("keeps the latest selected background when reads finish in reverse order", async () => {
  mount();
  await choose("A");
  await choose("B");
  await complete(1, "B");
  await complete(0, "A");
  expect(screen.getByAltText("Current dashboard background")).toHaveAttribute(
    "src",
    "data:image/png;base64,B",
  );
  expect(screen.getByRole("button", { name: "Save appearance" })).toBeEnabled();
});
it("removing a background cancels a pending read permanently", async () => {
  mount("/uploads/old.png");
  await choose("A");
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  await complete(0, "A");
  expect(
    screen.queryByAltText("Current dashboard background"),
  ).not.toBeInTheDocument();
  expect(
    screen
      .getByRole("region", { name: "Appearance preview" })
      .querySelector(".preview-background"),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Save appearance" })).toBeEnabled();
});
it("blocks save while reading and uploads only the finished current selection", async () => {
  const { save } = mount();
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ url: "/uploads/A.png" })),
  );
  vi.stubGlobal("fetch", fetch);
  await choose("A");
  expect(
    screen.getByRole("button", { name: "Save appearance" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  expect(save).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await complete(0, "A");
  await userEvent.click(
    screen.getByRole("button", { name: "Save appearance" }),
  );
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ background: "/uploads/A.png" }),
  );
});
it("discards pending reads when importing a configuration", async () => {
  mount("/uploads/old.png");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(input) === "/api/settings"
              ? { ...defaults, background: "/uploads/imported.png" }
              : String(input) === "/api/import/preview"
                ? { apps: 0, categories: 0, duplicates: 0 }
                : { imported: 0 },
          ),
        ),
    ),
  );
  await choose("A");
  await userEvent.click(screen.getByRole("tab", { name: "Backup" }));
  const backup = new File(["{}"], "backup.json", { type: "application/json" });
  Object.defineProperty(backup, "text", { value: async () => "{}" });
  await userEvent.upload(screen.getByLabelText("Import configuration"), backup);
  await userEvent.click(
    await screen.findByRole("button", { name: "Apply import" }),
  );
  await screen.findByText("Imported 0 applications.");
  await complete(0, "A");
  await userEvent.click(screen.getByRole("tab", { name: "Appearance" }));
  expect(screen.getByAltText("Current dashboard background")).toHaveAttribute(
    "src",
    "/uploads/imported.png",
  );
});
it("ignores a read that completes after its settings panel was unmounted", async () => {
  const first = mount();
  await choose("A");
  const stale = readers[0];
  first.unmount();
  render(
    <SettingsPanel
      settings={defaults}
      onSave={async () => {}}
      onClose={() => {}}
    />,
  );
  await act(async () => {
    stale.result = "data:image/png;base64,A";
    stale.onload?.();
  });
  expect(
    screen.queryByAltText("Current dashboard background"),
  ).not.toBeInTheDocument();
});
