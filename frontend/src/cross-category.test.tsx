import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { defaults, type Application } from "./lib";

afterEach(() => vi.unstubAllGlobals());
const initialApp: Application = {
  id: 1,
  name: "Atlas",
  url: "https://atlas.local",
  description: "Storage",
  icon: "builtin:server",
  category_id: 1,
  sort_order: 0,
  open_in_new_tab: true,
  favorite: false,
  icon_color: "auto",
};
function setup(rejectMove = false) {
  let apps = [{ ...initialApp }];
  const writes: unknown[] = [];
  const categories = [
    { id: 1, name: "General", sort_order: 0, collapsed: false },
    { id: 2, name: "Empty", sort_order: 1, collapsed: false },
    { id: 3, name: "Collapsed", sort_order: 2, collapsed: true },
  ];
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = String(url).replace("/api", "");
    if (init?.method === "PUT" && path === "/apps/reorder") {
      const payload = JSON.parse(String(init.body));
      writes.push(payload);
      if (rejectMove)
        return Response.json({ message: "Move failed" }, { status: 409 });
      apps = apps.map((app) =>
        app.id === payload.move.id
          ? { ...app, category_id: payload.move.category_id }
          : app,
      );
      return Response.json(
        {},
        { headers: { "X-HomeGrid-Undo": "move-token" } },
      );
    }
    const data =
      path === "/auth/session"
        ? { authenticated: true, username: "owner", csrf_token: "token" }
        : path === "/apps"
          ? apps
          : path === "/categories"
            ? categories
            : path === "/settings"
              ? defaults
              : [];
    return Response.json(data);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { writes };
}

it("moves directly into empty and collapsed categories in Organize without opening the editor", async () => {
  const { writes } = setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Organize" }),
  );
  const selector = screen.getByRole("combobox", {
    name: "Move Atlas to category",
  });
  expect(
    within(selector).getByRole("option", { name: "Empty" }),
  ).toBeInTheDocument();
  await userEvent.selectOptions(selector, "2");
  await waitFor(() =>
    expect(
      within(screen.getByRole("region", { name: "Empty" })).getByText("Atlas"),
    ).toBeVisible(),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Move Atlas to category" }),
    ).toHaveFocus(),
  );
  expect(writes).toEqual([{ ids: [1], move: { id: 1, category_id: 2 } }]);
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Move Atlas to category" }),
    "3",
  );
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual({ ids: [1], move: { id: 1, category_id: 3 } });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps the card in its original category and reports a rejected move", async () => {
  const { writes } = setup(true);
  await userEvent.click(
    await screen.findByRole("button", { name: "Organize" }),
  );
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Move Atlas to category" }),
    "2",
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "General" })).getByText("Atlas"),
  ).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Move Atlas to category" }),
  ).toHaveValue("1");
  expect(writes).toHaveLength(1);
});

it("prevents service navigation while organizing", async () => {
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Organize" }),
  );
  expect(fireEvent.click(screen.getByRole("link", { name: /Atlas/ }))).toBe(
    false,
  );
  expect(
    fireEvent(
      screen.getByRole("link", { name: /Atlas/ }),
      new MouseEvent("auxclick", {
        button: 1,
        bubbles: true,
        cancelable: true,
      }),
    ),
  ).toBe(false);
});
