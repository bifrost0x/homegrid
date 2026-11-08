import { useRef, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Application, Category } from "../lib";
import {
  applicationDrop,
  applicationDropAfter,
  launcherCollisionDetection,
  launcherKeyboardCoordinates,
  type ApplicationOrder,
} from "../sorting";

interface Options {
  apps: Application[];
  categories: Category[];
  enabled: boolean;
  onReorderCategories: (ids: number[]) => void;
  onApplicationDrop: (order: ApplicationOrder | null) => void;
}

/** Drag-and-drop wiring for Organize mode: sensors, collisions and drop handling. */
export function useOrganizeDrag({
  apps,
  categories,
  enabled,
  onReorderCategories,
  onApplicationDrop,
}: Options) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [draggedApp, setDraggedApp] = useState<Application | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: launcherKeyboardCoordinates,
    }),
  );
  const collisionDetection: CollisionDetection = (args) => {
    // Collision coordinates and droppable rects share the current viewport,
    // including while auto-scrolling. The source grab offset is irrelevant.
    pointer.current = args.pointerCoordinates;
    return launcherCollisionDetection(args);
  };
  function reset() {
    pointer.current = null;
    setDraggedApp(null);
  }
  function onDragStart({ active }: DragStartEvent) {
    pointer.current = null;
    setDraggedApp(apps.find((app) => "app-" + app.id === active.id) ?? null);
  }
  function onDragEnd(event: DragEndEvent) {
    const lastPointer = pointer.current;
    reset();
    if (!enabled || !event.over || event.active.id === event.over.id) return;
    const [kind, id] = String(event.active.id).split("-");
    if (kind === "app") {
      const activeRect = event.active.rect.current.translated;
      const grid = document
        .getElementById(String(event.over.id))
        ?.closest(".app-grid");
      // Computed tracks reflect list mode and responsive single-column layouts.
      const tracks = grid
        ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/)
        : [];
      const after = applicationDropAfter(
        event.over.rect,
        activeRect,
        lastPointer,
        tracks.length === 1,
      );
      onApplicationDrop(
        applicationDrop(apps, Number(id), String(event.over.id), after),
      );
      return;
    }
    if (!String(event.over.id).startsWith(kind + "-")) return;
    const [, over] = String(event.over.id).split("-");
    const from = categories.findIndex((c) => c.id === Number(id)),
      to = categories.findIndex((c) => c.id === Number(over));
    if (from >= 0 && to >= 0)
      onReorderCategories(
        arrayMove(
          categories.map((c) => c.id),
          from,
          to,
        ),
      );
  }
  return {
    draggedApp,
    context: {
      sensors,
      collisionDetection,
      onDragStart,
      onDragCancel: reset,
      onDragEnd,
    },
  };
}
