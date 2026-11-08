import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationForm } from "./ApplicationForm";
import type { Application } from "./lib";

afterEach(() => vi.unstubAllGlobals());

const category = { id: 1, name: "General", sort_order: 0, collapsed: false };
const previewIcon = () =>
  document.querySelector(".icon-preview img")?.getAttribute("src");
const fetched = "/uploads/" + "a".repeat(64) + ".png";

function stubDiscovery(response: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url) === "/api/icons/discover") {
      calls.push(JSON.parse(String(init?.body)).url);
      return response();
    }
    return Response.json({});
  });
  return calls;
}

function renderForm(app?: Application) {
  const onSave = vi.fn(async () => {});
  render(
    <ApplicationForm
      app={app}
      categories={[category]}
      onSave={onSave}
      onClose={() => {}}
    />,
  );
  return onSave;
}

async function enterUrl(value: string) {
  await userEvent.type(screen.getByLabelText("Application URL"), value);
  await userEvent.tab();
}

it("asks an unknown service for its logo and lets the user keep the old icon", async () => {
  const calls = stubDiscovery(() =>
    Response.json({ url: fetched, title: "Team Notes" }, { status: 201 }),
  );
  const onSave = renderForm();
  await enterUrl("https://notes.home.example/app");
  await screen.findByText(/Using the logo from/);
  expect(calls).toEqual(["https://notes.home.example/app"]);
  expect(previewIcon()).toBe(fetched);
  // The page title replaces the name HomeGrid derived from the hostname.
  expect(screen.getByLabelText("Application name")).toHaveValue("Team Notes");
  await userEvent.click(
    screen.getByRole("button", { name: "Keep previous icon" }),
  );
  expect(document.querySelector(".icon-preview strong")).toHaveTextContent(
    "Automatic favicon",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Add application" }),
  );
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ icon: "favicon" }),
  );
});

it("does not ask the service when the catalog already knows it", async () => {
  const calls = stubDiscovery(() =>
    Response.json({ url: fetched }, { status: 201 }),
  );
  renderForm();
  await enterUrl("https://jellyfin.home.example");
  expect(previewIcon()).toBe("/service-icons/jellyfin.svg");
  expect(calls).toEqual([]);
});

it("explains a failed lookup and keeps the current icon", async () => {
  stubDiscovery(() =>
    Response.json(
      {
        error: {
          code: "not_found",
          message: "This service does not offer an icon HomeGrid can use",
        },
      },
      { status: 404 },
    ),
  );
  renderForm();
  await enterUrl("https://notes.home.example");
  expect(
    await screen.findByText(/No logo from notes\.home\.example/),
  ).toBeVisible();
  expect(document.querySelector(".icon-preview strong")).toHaveTextContent(
    "Automatic favicon",
  );
});

it("fetches on request when editing and treats it as the user's choice", async () => {
  const calls = stubDiscovery(() =>
    Response.json({ url: fetched }, { status: 201 }),
  );
  const onSave = renderForm({
    id: 4,
    name: "Notes",
    url: "https://notes.home.example",
    description: "",
    icon: "builtin:notebook",
    category_id: 1,
    sort_order: 0,
    open_in_new_tab: true,
    favorite: false,
    icon_color: "auto",
  });
  expect(calls).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "From service" }));
  await waitFor(() => expect(previewIcon()).toBe(fetched));
  expect(
    screen.queryByRole("button", { name: "Keep previous icon" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ icon: fetched }),
  );
});

it("never replaces a name the user typed", async () => {
  stubDiscovery(() =>
    Response.json({ url: fetched, title: "Team Notes" }, { status: 201 }),
  );
  renderForm();
  await userEvent.type(screen.getByLabelText("Application name"), "My wiki");
  await enterUrl("https://notes.home.example");
  await screen.findByText(/Using the logo from/);
  expect(screen.getByLabelText("Application name")).toHaveValue("My wiki");
});
