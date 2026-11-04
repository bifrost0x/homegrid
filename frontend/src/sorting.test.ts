import { it, expect } from "vitest";
import type { KeyboardCoordinateGetter } from "@dnd-kit/core";
import { launcherKeyboardCoordinates } from "./sorting";

it("keyboard category sorting skips nested app targets", () => {
  const rect = (top: number, height: number) => ({
    top,
    left: 0,
    width: 400,
    height,
    right: 400,
    bottom: top + height,
  });
  const container = (id: string, index: number, group: string) => ({
    id,
    key: id,
    disabled: false,
    node: { current: document.createElement("section") },
    data: { current: { sortable: { containerId: group, index } } },
    rect: { current: null },
  });
  const entries = [
    container("category-1", 0, "categories"),
    container("app-1", 0, "apps"),
    container("category-2", 1, "categories"),
  ];
  const containers = new Map(entries.map((c) => [c.id, c]));
  Object.assign(containers, { getEnabled: () => entries });
  const args = {
    active: "category-1",
    currentCoordinates: { x: 0, y: 100 },
    context: {
      active: { id: "category-1" },
      collisionRect: rect(100, 300),
      droppableRects: new Map([
        ["category-1", rect(100, 300)],
        ["app-1", rect(150, 100)],
        ["category-2", rect(450, 300)],
      ]),
      droppableContainers: containers,
      over: { id: "category-1" },
      scrollableAncestors: [],
    },
  } as unknown as Parameters<KeyboardCoordinateGetter>[1];
  expect(
    launcherKeyboardCoordinates(
      new KeyboardEvent("keydown", { code: "ArrowDown" }),
      args,
    ),
  ).toEqual({ x: 0, y: 450 });
});
