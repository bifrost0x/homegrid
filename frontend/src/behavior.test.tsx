import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryForm, Icon, CommandPalette } from "./components";
import { ApplicationForm } from "./ApplicationForm";
import { filterApps, moveApplication, appHostname } from "./lib";
import { appSchema } from "./appSchema";
describe("launcher behavior", () => {
  const category = { id: 1, name: "General", collapsed: false, sort_order: 0 };
  const app = {
    id: 1,
    name: "Cinema",
    url: "https://media.local",
    description: "Family movies",
    icon: "builtin:film",
    category_id: 1,
    sort_order: 0,
    open_in_new_tab: true,
    favorite: false,
    icon_color: "auto" as const,
  };
  it("survives malformed legacy URLs", () => {
    expect(appHostname("https://[xyz]")).toBe("Application");
    expect(appHostname(app.url)).toBe("media.local");
  });
  it("edits an application and changes its category", async () => {
    const save = vi.fn(async () => {});
    render(
      <ApplicationForm
        app={app}
        categories={[category, { ...category, id: 2, name: "Media" }]}
        onSave={save}
        onClose={() => {}}
      />,
    );
    await userEvent.clear(screen.getByLabelText("Application name"));
    await userEvent.type(screen.getByLabelText("Application name"), "Movies");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Movies", category_id: 2 }),
    );
  });
  it("filters the bundled icon picker and saves a selected icon", async () => {
    const save = vi.fn(async () => {});
    render(
      <ApplicationForm
        app={app}
        categories={[category]}
        onSave={save}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByLabelText("Search icons"), "cloud");
    expect(
      screen.queryByRole("button", { name: "Use server icon" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Use cloud icon" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ icon: "builtin:cloud" }),
    );
  });
  it("renames a category", async () => {
    const save = vi.fn(async () => {});
    render(
      <CategoryForm category={category} onSave={save} onClose={() => {}} />,
    );
    await userEvent.clear(screen.getByLabelText("Category name"));
    await userEvent.type(
      screen.getByLabelText("Category name"),
      "Infrastructure",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save category" }),
    );
    expect(save).toHaveBeenCalledWith("Infrastructure");
  });
  it("provides keyboard search selection and launch", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <CommandPalette
        apps={[app, { ...app, id: 2, name: "Storage" }]}
        categories={[category]}
        onClose={() => {}}
      />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "storage");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(open).toHaveBeenCalledWith(app.url, "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
  it("searches names, descriptions and categories", () => {
    const apps = [
      {
        id: 1,
        name: "Cinema",
        url: "https://media.local",
        description: "Family movies",
        icon: "builtin:film",
        category_id: 2,
        sort_order: 0,
        open_in_new_tab: true,
        favorite: false,
        icon_color: "auto" as const,
      },
    ];
    expect(
      filterApps(
        apps,
        [{ id: 2, name: "Entertainment", collapsed: false, sort_order: 0 }],
        "entertainment",
      ),
    ).toHaveLength(1);
    expect(filterApps(apps, [], "movies")).toHaveLength(1);
    expect(filterApps(apps, [], "missing")).toHaveLength(0);
  });
  it("rejects unsafe schemes and missing names", () => {
    expect(
      appSchema.safeParse({ name: "", url: "javascript:alert(1)" }).success,
    ).toBe(false);
  });
  it("moves between visible siblings when categories are interleaved", () => {
    const base = {
      name: "App",
      url: "https://home.local",
      description: "",
      icon: "builtin:server",
      sort_order: 0,
      open_in_new_tab: true,
      favorite: false,
      icon_color: "auto" as const,
    };
    const apps = [
      { ...base, id: 1, category_id: 1 },
      { ...base, id: 2, category_id: 2 },
      { ...base, id: 3, category_id: 1 },
    ];
    expect(moveApplication(apps, 1, 1)).toEqual([3, 2, 1]);
    expect(moveApplication(apps, 3, 1)).toEqual([1, 2, 3]);
  });
  it("validates the create form before saving", async () => {
    render(
      <ApplicationForm
        categories={[]}
        onSave={async () => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add application" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("name");
  });
});
