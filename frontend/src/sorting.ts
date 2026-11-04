import type { KeyboardCoordinateGetter } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

export const launcherKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  args,
) => {
  const prefix = String(args.active).split("-")[0] + "-";
  // Category sections contain app droppables. Keep keyboard target discovery
  // consistent with collision detection so an arrow moves to the next peer.
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
