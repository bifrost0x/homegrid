import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { appHostname, isExampleApp, type Application } from "../lib";
import { Icon } from "../components";
import { CardMenu } from "./CardMenu";
import { useDashboard } from "./context";

export function AppCard({
  app,
  first,
  last,
}: {
  app: Application;
  first: boolean;
  last: boolean;
}) {
  const { busy, organizing, descriptions, categories, applications } =
    useDashboard();
  const sortable = useSortable({
    id: "app-" + app.id,
    disabled: busy || !organizing,
  });
  const example = isExampleApp(app);
  const LaunchElement = example ? "button" : "a";
  return (
    <article
      id={"app-" + app.id}
      data-testid="application-card"
      className={
        "app-card" +
        (organizing ? " organizing" : "") +
        (app.favorite ? " is-favorite" : "") +
        (sortable.isDragging ? " dragging" : "")
      }
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
    >
      <LaunchElement
        className="app-link"
        href={example ? undefined : app.url}
        type={example ? "button" : undefined}
        onAuxClick={(event) => {
          if (organizing) event.preventDefault();
        }}
        onClick={(event) => {
          if (organizing) {
            event.preventDefault();
            return;
          }
          if (example) {
            event.preventDefault();
            applications.edit(app);
          }
        }}
        target={app.open_in_new_tab ? "_blank" : undefined}
        rel={app.open_in_new_tab ? "noopener noreferrer" : undefined}
      >
        <Icon app={app} />
        <span className="app-copy">
          <strong>{app.name}</strong>
          {example ? (
            <small className="example-label">Example · Add your URL</small>
          ) : (
            descriptions && (
              <small>{app.description || appHostname(app.url)}</small>
            )
          )}
        </span>
      </LaunchElement>
      <div className="card-actions">
        {organizing && (
          <>
            <button
              className="drag-handle"
              aria-label={"Drag " + app.name}
              {...sortable.attributes}
              {...sortable.listeners}
            >
              <GripVertical size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={"Move " + app.name + " up"}
              disabled={first || busy}
              onClick={() => applications.move(app, -1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={"Move " + app.name + " down"}
              disabled={last || busy}
              onClick={() => applications.move(app, 1)}
            >
              <ArrowDown size={14} />
            </button>
          </>
        )}
        <button
          className="icon-button favorite-toggle"
          aria-label={
            (app.favorite ? "Remove " : "Add ") +
            app.name +
            (app.favorite ? " from favorites" : " to favorites")
          }
          aria-pressed={app.favorite}
          disabled={busy}
          onClick={() => applications.toggleFavorite(app)}
          title={app.favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star size={15} fill={app.favorite ? "currentColor" : "none"} />
        </button>
        <CardMenu
          label={app.name}
          items={[
            {
              label: "Edit",
              name: "Edit " + app.name,
              icon: <Pencil size={15} />,
              onSelect: () => applications.edit(app),
            },
            {
              label: "Duplicate",
              name: "Duplicate " + app.name,
              icon: <Copy size={15} />,
              onSelect: () => applications.duplicate(app),
            },
            {
              label: "Delete",
              name: "Delete " + app.name,
              icon: <Trash2 size={15} />,
              danger: true,
              onSelect: () => applications.remove(app),
            },
          ]}
        />
      </div>
      {organizing && (
        <select
          id={"move-category-" + app.id}
          className="move-category-select"
          aria-label={"Move " + app.name + " to category"}
          value={app.category_id}
          disabled={busy}
          onChange={(event) =>
            applications.moveToCategory(app, Number(event.target.value))
          }
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      )}
    </article>
  );
}

/** Lightweight copy of a card shown under the pointer while dragging. */
export function AppDragPreview({ app }: { app: Application }) {
  return (
    <div className="app-card app-drag-preview" aria-hidden="true">
      <div className="app-link">
        <Icon app={app} />
        <span className="app-copy">
          <strong>{app.name}</strong>
        </span>
      </div>
    </div>
  );
}
