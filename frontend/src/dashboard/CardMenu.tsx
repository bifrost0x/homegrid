import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export interface CardMenuItem {
  label: string;
  /** Accessible name; defaults to the visible label. */
  name?: string;
  icon: ReactNode;
  danger?: boolean;
  /** Draws a divider above this item. */
  separated?: boolean;
  onSelect: () => void;
}

const gap = 6;
const edge = 8;

/**
 * Menu button following the WAI-ARIA menu pattern. The menu is portalled to the
 * document body so card clipping, transforms and backdrop filters cannot hide it.
 */
export function CardMenu({
  label,
  items,
  disabled,
  triggerLabel,
  trigger: triggerContent,
  triggerClassName = "icon-button card-menu-trigger",
  heading,
}: {
  label: string;
  items: CardMenuItem[];
  disabled?: boolean;
  /**
   * Accessible name of the trigger; defaults to "More actions for <label>".
   * Pass null when the trigger content already names it.
   */
  triggerLabel?: string | null;
  /** Visible trigger content; defaults to a "more" icon. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Non-interactive context shown above the items. */
  heading?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setPosition(undefined);
    if (restoreFocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const { width, height } = menu.current.getBoundingClientRect();
    const below = anchor.bottom + gap;
    const top =
      below + height > window.innerHeight - edge &&
      anchor.top - gap - height >= edge
        ? anchor.top - gap - height
        : below;
    const left = Math.min(
      Math.max(edge, anchor.right - width),
      window.innerWidth - width - edge,
    );
    setPosition({ top, left });
    menu.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target))
        close(false);
    };
    const dismiss = () => close(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = Array.from(
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const current = entries.indexOf(document.activeElement as HTMLElement);
    const focus = (index: number) =>
      entries[(index + entries.length) % entries.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        focus(current + 1);
        break;
      case "ArrowUp":
        focus(current - 1);
        break;
      case "Home":
        focus(0);
        break;
      case "End":
        focus(entries.length - 1);
        break;
      case "Escape":
        close(true);
        break;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={triggerClassName + (open ? " open" : "")}
        aria-label={
          triggerLabel === null
            ? undefined
            : (triggerLabel ?? "More actions for " + label)
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {triggerContent ?? <MoreHorizontal size={16} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label + " actions"}
            className="card-menu"
            style={
              position
                ? { top: position.top, left: position.left }
                : { top: 0, left: 0, opacity: 0 }
            }
            onKeyDown={onMenuKeyDown}
          >
            {heading && (
              <div className="card-menu-heading" role="presentation">
                {heading}
              </div>
            )}
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-label={item.name}
                className={
                  "card-menu-item" +
                  (item.danger ? " destructive" : "") +
                  (item.separated ? " separated" : "")
                }
                onClick={() => {
                  // Return focus to the trigger first so dialogs restore it on close.
                  close(true);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
