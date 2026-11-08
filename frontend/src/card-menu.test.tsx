import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardMenu } from "./dashboard/CardMenu";

function setup() {
  const edit = vi.fn(),
    remove = vi.fn();
  render(
    <>
      <CardMenu
        label="Atlas"
        items={[
          { label: "Edit", name: "Edit Atlas", icon: null, onSelect: edit },
          {
            label: "Delete",
            name: "Delete Atlas",
            icon: null,
            danger: true,
            onSelect: remove,
          },
        ]}
      />
      <button>Elsewhere</button>
    </>,
  );
  return {
    edit,
    remove,
    trigger: screen.getByRole("button", { name: "More actions for Atlas" }),
  };
}

it("opens a labelled menu, focuses the first item and runs the chosen action", async () => {
  const { edit, trigger } = setup();
  expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(trigger);
  const menu = screen.getByRole("menu", { name: "Atlas actions" });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(trigger).toHaveAttribute("aria-controls", menu.id);
  expect(screen.getByRole("menuitem", { name: "Edit Atlas" })).toHaveFocus();
  await userEvent.click(screen.getByRole("menuitem", { name: "Edit Atlas" }));
  expect(edit).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("supports arrow keys, wrapping, Escape and Enter", async () => {
  const { remove, trigger } = setup();
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  const edit = screen.getByRole("menuitem", { name: "Edit Atlas" });
  const del = screen.getByRole("menuitem", { name: "Delete Atlas" });
  expect(edit).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(del).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(edit).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(del).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(remove).not.toHaveBeenCalled();
  await userEvent.keyboard("{ArrowUp}{End}{Enter}");
  expect(remove).toHaveBeenCalledOnce();
});

it("closes without acting when the pointer goes elsewhere", async () => {
  const { edit, remove, trigger } = setup();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(edit).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
