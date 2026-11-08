import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { Application, Category } from "../lib";
import { AppCard } from "./AppCard";
import { useDashboard } from "./context";

export function CategorySection({
  category,
  apps,
  first,
  last,
  showEmptyAction,
}: {
  category: Category;
  apps: Application[];
  first: boolean;
  last: boolean;
  /** Offer an add button when the category is empty but others are not. */
  showEmptyAction: boolean;
}) {
  const { busy, organizing, categoryActions } = useDashboard();
  const sortable = useSortable({
    id: "category-" + category.id,
    disabled: busy || !organizing,
  });
  const drop = useDroppable({
    id: "app-category-" + category.id,
    disabled: busy || !organizing,
  });
  return (
    <section
      ref={(node) => {
        sortable.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={
        "category-section " +
        (sortable.isDragging ? "dragging " : "") +
        (organizing ? "category-drop-target " : "") +
        (drop.isOver ? "drop-active" : "")
      }
      aria-label={category.name}
    >
      <div className="category-heading">
        {organizing && (
          <button
            className="drag-handle"
            aria-label={"Drag category " + category.name}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={15} />
          </button>
        )}
        <button
          id={"category-toggle-" + category.id}
          className="category-toggle"
          aria-expanded={!category.collapsed}
          onClick={() => categoryActions.toggle(category)}
        >
          <ChevronDown
            size={17}
            className={category.collapsed ? "collapsed-chevron" : ""}
          />
          <h2>{category.name}</h2>
          <span>{apps.length}</span>
        </button>
        {organizing && (
          <div className="category-actions">
            <button
              className="icon-button"
              aria-label={"Move category " + category.name + " up"}
              disabled={first || busy}
              onClick={() => categoryActions.move(category, -1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={"Move category " + category.name + " down"}
              disabled={last || busy}
              onClick={() => categoryActions.move(category, 1)}
            >
              <ArrowDown size={15} />
            </button>
            <button
              className="icon-button"
              aria-label={"Edit category " + category.name}
              onClick={() => categoryActions.edit(category)}
            >
              <Pencil size={14} />
            </button>
            {category.id !== 1 && (
              <button
                className="icon-button"
                aria-label={"Delete category " + category.name}
                onClick={() => categoryActions.remove(category)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
      {!category.collapsed && (
        <SortableContext
          items={apps.map((a) => "app-" + a.id)}
          strategy={rectSortingStrategy}
        >
          <div className="app-grid">
            {apps.map((app, index) => (
              <AppCard
                key={app.id}
                app={app}
                first={index === 0}
                last={index === apps.length - 1}
              />
            ))}
            {!apps.length && showEmptyAction && (
              <button
                className="empty-category"
                onClick={() => categoryActions.addApplication(category)}
              >
                <Plus size={17} />
                Add an application
              </button>
            )}
          </div>
        </SortableContext>
      )}
    </section>
  );
}
