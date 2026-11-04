import {
  closestCenter,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Application } from "./lib";

export interface ApplicationOrder {
  ids: number[];
  move?: { id: number; category_id: number };
}

type DropRect = { left: number; top: number; width: number; height: number };
export function applicationDropAfter(
  target: DropRect,
  translated: DropRect | null,
  pointer: { x: number; y: number } | null,
  vertical: boolean,
): boolean {
  if (pointer) {
    return vertical
      ? pointer.y > target.top + target.height / 2
      : pointer.x > target.left + target.width / 2;
  }
  const sameRow =
    translated && Math.abs(translated.top - target.top) < target.height / 2;
  return translated
    ? sameRow
      ? translated.left + translated.width / 2 > target.left + target.width / 2
      : translated.top + translated.height / 2 > target.top + target.height / 2
    : false;
}

export function applicationDrop(
  apps: Application[],
  id: number,
  target: string,
  after = false,
): ApplicationOrder | null {
  const app = apps.find((item) => item.id === id);
  if (!app) return null;
  const group = /^app-category-([1-9]\d*)$/.exec(target);
  const card = /^app-([1-9]\d*)$/.exec(target);
  const over = card
    ? apps.find((item) => item.id === Number(card[1]))
    : undefined;
  const categoryId = group ? Number(group[1]) : over?.category_id;
  if (!categoryId || over?.id === id) return null;
  const ids = apps.map((item) => item.id);
  if (categoryId === app.category_id) {
    if (!over) return null;
    return { ids: arrayMove(ids, ids.indexOf(id), ids.indexOf(over.id)) };
  }
  const remaining = apps.filter((item) => item.id !== id);
  let index = over
    ? remaining.findIndex((item) => item.id === over.id) + Number(after)
    : -1;
  if (!over) {
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].category_id === categoryId) index = i + 1;
    }
    if (index < 0) index = remaining.length;
  }
  const ordered = remaining.map((item) => item.id);
  ordered.splice(index, 0, id);
  return { ids: ordered, move: { id, category_id: categoryId } };
}

export const launcherCollisionDetection: CollisionDetection = (args) => {
  if (String(args.active.id).startsWith("category-")) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((item) =>
        String(item.id).startsWith("category-"),
      ),
    });
  }
  const containers = args.droppableContainers.filter((item) =>
    String(item.id).startsWith("app-"),
  );
  const collisions = args.pointerCoordinates
    ? pointerWithin({ ...args, droppableContainers: containers })
    : rectIntersection({ ...args, droppableContainers: containers });
  // A card lies inside its group drop zone. Prefer the precise card target.
  const cards = collisions.filter((item) => /^app-\d+$/.test(String(item.id)));
  return cards.length ? cards : collisions;
};

export const launcherKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  args,
) => {
  const prefix = String(args.active).split("-")[0] + "-";
  // App targets include group drop zones, including empty/collapsed groups.
  // Category sorting must continue to skip all nested application targets.
  const droppableRects = new Map(
    [...args.context.droppableRects].filter(([id]) =>
      String(id).startsWith(prefix),
    ),
  );
  return sortableKeyboardCoordinates(event, {
    ...args,
    context: { ...args.context, droppableRects },
  });
};
