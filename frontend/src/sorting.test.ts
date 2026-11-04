import { it, expect } from "vitest";
import type { KeyboardCoordinateGetter } from "@dnd-kit/core";
import {
  launcherKeyboardCoordinates,
  applicationDrop,
  launcherCollisionDetection,
} from "./sorting";
import type { Application } from "./lib";

const apps = [
  { id: 1, category_id: 1 },
  { id: 2, category_id: 2 },
  { id: 3, category_id: 1 },
  { id: 4, category_id: 2 },
] as Application[];

it("moves across categories before or after the hovered card with one full ordering", () => {
  expect(applicationDrop(apps, 1, "app-4", false)).toEqual({
    ids: [2, 3, 1, 4],
    move: { id: 1, category_id: 2 },
  });
  expect(applicationDrop(apps, 1, "app-4", true)).toEqual({
    ids: [2, 3, 4, 1],
    move: { id: 1, category_id: 2 },
  });
});
it("appends to empty, collapsed and populated category targets", () => {
  expect(applicationDrop(apps, 1, "app-category-3")).toEqual({
    ids: [2, 3, 4, 1],
    move: { id: 1, category_id: 3 },
  });
  expect(applicationDrop(apps, 1, "app-category-2")).toEqual({
    ids: [2, 3, 4, 1],
    move: { id: 1, category_id: 2 },
  });
});
it("keeps same-category drag ordering and ignores own group and invalid targets", () => {
  expect(applicationDrop(apps, 1, "app-3")).toEqual({ ids: [2, 3, 1, 4] });
  expect(applicationDrop(apps, 1, "app-category-1")).toBeNull();
  expect(applicationDrop(apps, 1, "category-2")).toBeNull();
  expect(applicationDrop(apps, 1, "app-99")).toBeNull();
  expect(applicationDrop(apps, 1, "app-1")).toBeNull();
});

it("targets cards before containing groups, accepts collapsed groups, and cancels outside drops", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const args = {
    active: { id: "app-1" },
    collisionRect: rect(0, 0, 100, 50),
    pointerCoordinates: { x: 150, y: 125 },
    droppableRects: new Map([
      ["category-2", rect(100, 100, 300, 200)],
      ["app-category-2", rect(100, 100, 300, 200)],
      ["app-4", rect(125, 110, 100, 50)],
      ["app-category-3", rect(100, 350, 300, 45)],
    ]),
    droppableContainers: [
      "category-2",
      "app-category-2",
      "app-4",
      "app-category-3",
    ].map((id) => ({ id })),
  } as unknown as Parameters<typeof launcherCollisionDetection>[0];
  expect(launcherCollisionDetection(args).map((item) => item.id)).toEqual([
    "app-4",
  ]);
  expect(
    launcherCollisionDetection({
      ...args,
      pointerCoordinates: { x: 150, y: 375 },
    }).map((item) => item.id),
  ).toEqual(["app-category-3"]);
  expect(
    launcherCollisionDetection({
      ...args,
      pointerCoordinates: { x: 500, y: 500 },
    }),
  ).toEqual([]);
  expect(
    launcherCollisionDetection({
      ...args,
      active: { ...args.active, id: "category-1" },
    }).map((item) => item.id),
  ).toEqual(["category-2"]);
});

it("keyboard app dragging can reach an empty or collapsed category drop zone", () => {
  const rect = (top: number, height: number) => ({
    top,
    left: 0,
    width: 400,
    height,
    right: 400,
    bottom: top + height,
  });
  const entries = ["app-1", "category-2", "app-category-2"].map((id) => ({
    id,
    key: id,
    disabled: false,
    node: { current: document.createElement("section") },
    data: { current: {} },
    rect: { current: null },
  }));
  const containers = new Map(entries.map((item) => [item.id, item]));
  Object.assign(containers, { getEnabled: () => entries });
  const args = {
    active: "app-1",
    currentCoordinates: { x: 0, y: 100 },
    context: {
      active: { id: "app-1" },
      collisionRect: rect(100, 100),
      droppableRects: new Map([
        ["app-1", rect(100, 100)],
        ["category-2", rect(250, 45)],
        ["app-category-2", rect(250, 45)],
      ]),
      droppableContainers: containers,
      over: { id: "app-1" },
      scrollableAncestors: [],
    },
  } as unknown as Parameters<KeyboardCoordinateGetter>[1];
  expect(
    launcherKeyboardCoordinates(
      new KeyboardEvent("keydown", { code: "ArrowDown" }),
      args,
    ),
  ).toEqual({ x: 0, y: 250 });
});

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
