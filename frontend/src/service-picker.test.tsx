import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IconPicker, SERVICE_RESULT_LIMIT } from "./IconPicker";
import { findIcons } from "./catalog";
import { serviceIcons } from "./serviceIndex";

it("offers generic icons and popular services first and preserves a selected service with one tab stop", async () => {
  const onChange = vi.fn();
  render(<IconPicker value="service:jellyfin" query="" onChange={onChange} />);
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(findIcons("").length + SERVICE_RESULT_LIMIT);
  expect(
    screen.getByText(
      `Showing popular services. Search to find all ${serviceIcons.length} logos.`,
    ),
  ).toBeInTheDocument();
  const jellyfin = screen.getByRole("button", {
    name: "Use Jellyfin service icon",
  });
  expect(jellyfin).toHaveAttribute("aria-pressed", "true");
  expect(jellyfin).toHaveAttribute("tabindex", "0");
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  expect(jellyfin.querySelector("img")).toHaveAttribute(
    "src",
    "/service-icons/jellyfin.svg",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Use Plex service icon" }),
  );
  expect(onChange).toHaveBeenCalledWith("service:plex");
});

it("prioritizes service names in search and keeps generic keyword matches", () => {
  render(
    <IconPicker value="builtin:server" query="Jellyfin" onChange={() => {}} />,
  );
  const buttons = screen.getAllByRole("button");
  expect(buttons[0]).toHaveAccessibleName("Use Jellyfin service icon");
  expect(
    screen.getByRole("button", { name: "Use film icon" }),
  ).toBeInTheDocument();
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
});

it("shows a useful empty state for an unknown query", () => {
  render(
    <IconPicker
      value="service:jellyfin"
      query="unknown-service-xyz"
      onChange={() => {}}
    />,
  );
  expect(
    screen.getByText("No icons found. Try a different keyword."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("replaces failed local artwork with a vector fallback", () => {
  render(
    <IconPicker
      value="service:jellyfin"
      query="Jellyfin"
      onChange={() => {}}
    />,
  );
  const button = screen.getByRole("button", {
    name: "Use Jellyfin service icon",
  });
  fireEvent.error(button.querySelector("img")!);
  expect(button.querySelector("img")).toBeNull();
  expect(button.querySelector("svg.lucide-globe")).not.toBeNull();
});

it("moves across generic and service entries using rendered grid columns", async () => {
  render(<IconPicker value="builtin:server" query="" onChange={() => {}} />);
  screen.getByRole("toolbar").style.gridTemplateColumns = "repeat(4, 50px)";
  const buttons = screen.getAllByRole("button");
  buttons[0].focus();
  await userEvent.keyboard("{End}");
  expect(buttons.at(-1)).toHaveFocus();
  await userEvent.keyboard("{Home}{ArrowDown}");
  expect(buttons[4]).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}{ArrowRight}");
  expect(buttons[1]).toHaveFocus();
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
});

it("finds service logos by curated alias", () => {
  render(<IconPicker value="favicon" query="pve" onChange={() => {}} />);
  expect(screen.getAllByRole("button")[0]).toHaveAccessibleName(
    "Use Proxmox service icon",
  );
});

it("searches the extended tier, caps the rendered results and explains the rest", () => {
  const { rerender } = render(
    <IconPicker value="favicon" query="sshwifty" onChange={() => {}} />,
  );
  expect(screen.getAllByRole("button")[0]).toHaveAccessibleName(
    "Use Sshwifty service icon",
  );
  expect(screen.getAllByRole("button")[0].querySelector("img")).toHaveAttribute(
    "src",
    "/service-icons/sshwifty.svg",
  );
  expect(screen.getAllByRole("button")[0].querySelector("img")).toHaveAttribute(
    "loading",
    "lazy",
  );

  // "a" matches far more logos than are rendered.
  rerender(<IconPicker value="favicon" query="a" onChange={() => {}} />);
  const services = screen
    .getAllByRole("button")
    .filter((button) => button.dataset.iconId?.startsWith("service:"));
  expect(services).toHaveLength(SERVICE_RESULT_LIMIT);
  expect(
    screen.getByText(
      /^\d+ more matching logos\. Refine your search to see them\.$/,
    ),
  ).toBeInTheDocument();
});

it("ranks exact names and aliases first, curated before extended", () => {
  render(<IconPicker value="favicon" query="unifi" onChange={() => {}} />);
  const names = screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
  expect(names[0]).toBe("Use UniFi service icon");
  expect(names).toContain("Use Ubiquiti UniFi service icon");
});

it("keeps a selected extended logo visible without a query", () => {
  render(<IconPicker value="service:sshwifty" query="" onChange={() => {}} />);
  const selected = screen.getByRole("button", {
    name: "Use Sshwifty service icon",
  });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(selected).toHaveAttribute("tabindex", "0");
});
