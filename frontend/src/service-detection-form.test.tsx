import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplicationForm } from "./ApplicationForm";
import type { Application } from "./lib";

const category = { id: 1, name: "General", sort_order: 0, collapsed: false };
const previewIcon = () =>
  document.querySelector(".icon-preview img")?.getAttribute("src");
const status = () => screen.getByRole("status");

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

it("selects a recognized service logo from the name and saves it", async () => {
  const onSave = renderForm();
  expect(status()).toBeEmptyDOMElement();
  await userEvent.type(screen.getByLabelText("Application name"), "Jellyfin");
  expect(status()).toHaveTextContent(
    "Recognized Jellyfin. Its logo is selected.",
  );
  expect(previewIcon()).toBe("/service-icons/jellyfin.svg");
  expect(document.querySelector(".icon-preview strong")).toHaveTextContent(
    "Jellyfin",
  );
  expect(
    screen.getByRole("button", { name: "Use Jellyfin service icon" }),
  ).toHaveAttribute("aria-pressed", "true");
  await userEvent.type(
    screen.getByLabelText("Application URL"),
    "https://media.example.com",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Add application" }),
  );
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Jellyfin", icon: "service:jellyfin" }),
  );
});

it("recognizes a service from the address and names the application after it", async () => {
  renderForm();
  await userEvent.type(
    screen.getByLabelText("Application URL"),
    "https://pve.lan:8006",
  );
  expect(status()).toHaveTextContent(
    "Recognized Proxmox from the address. Its logo is selected.",
  );
  await userEvent.tab();
  expect(screen.getByLabelText("Application name")).toHaveValue("Proxmox");
  expect(previewIcon()).toBe("/service-icons/proxmox.svg");
});

it("mentions a port-only match and reverts when the hint no longer applies", async () => {
  renderForm();
  const url = screen.getByLabelText("Application URL");
  await userEvent.type(url, "http://192.168.1.10:8096");
  expect(status()).toHaveTextContent(
    "Recognized Jellyfin from its default port.",
  );
  await userEvent.clear(url);
  await userEvent.type(url, "http://192.168.1.10:8080");
  expect(status()).toBeEmptyDOMElement();
  expect(document.querySelector(".icon-preview strong")).toHaveTextContent(
    "Automatic favicon",
  );
});

it("lets the user keep the previous icon and then stops recognizing", async () => {
  const onSave = renderForm();
  const name = screen.getByLabelText("Application name");
  await userEvent.type(name, "Plex");
  await userEvent.click(
    within(status().parentElement!).getByRole("button", {
      name: "Keep previous icon",
    }),
  );
  expect(status()).toBeEmptyDOMElement();
  expect(document.querySelector(".icon-preview strong")).toHaveTextContent(
    "Automatic favicon",
  );
  await userEvent.clear(name);
  await userEvent.type(name, "Jellyfin");
  expect(status()).toBeEmptyDOMElement();
  await userEvent.type(
    screen.getByLabelText("Application URL"),
    "https://jellyfin.lan",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Add application" }),
  );
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ icon: "favicon" }),
  );
});

it("never overwrites an icon the user picked", async () => {
  renderForm();
  await userEvent.click(screen.getByRole("button", { name: "Use film icon" }));
  await userEvent.type(screen.getByLabelText("Application name"), "Jellyfin");
  await userEvent.type(
    screen.getByLabelText("Application URL"),
    "https://plex.lan:32400",
  );
  expect(status()).toBeEmptyDOMElement();
  expect(screen.getByRole("button", { name: "Use film icon" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("leaves existing applications untouched while editing", async () => {
  renderForm({
    id: 1,
    name: "Cinema",
    url: "https://media.home",
    description: "",
    icon: "builtin:film",
    icon_color: "auto",
    favorite: false,
    category_id: 1,
    sort_order: 0,
    open_in_new_tab: true,
  });
  const name = screen.getByLabelText("Application name");
  await userEvent.clear(name);
  await userEvent.type(name, "Jellyfin");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button", { name: "Use film icon" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
