import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { findIcons } from "./builtinIcons";
import { serviceIconUrl } from "./serviceIcons";
import {
  findServiceIcon,
  searchServiceIcons,
  serviceIcons,
} from "./serviceIndex";

// Thousands of logos are bundled; the picker renders a bounded set and asks
// for a more specific search beyond it.
export const SERVICE_RESULT_LIMIT = 60;

function ServiceThumbnail({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <Globe size={21} />
  ) : (
    <img
      className="service-picker-logo"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      width={28}
      height={28}
      onError={() => setFailed(true)}
    />
  );
}

export function IconPicker({
  value,
  query,
  onChange,
}: {
  value: string;
  query: string;
  onChange: (value: string) => void;
}) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const genericEntries = findIcons(query).map(([id, Icon]) => ({
    id,
    value: "builtin:" + id,
    label: id + " icon",
    content: <Icon size={21} />,
  }));
  const matches = useMemo(() => searchServiceIcons(query), [query]);
  const shown = matches.slice(0, SERVICE_RESULT_LIMIT);
  // Keep the current logo visible even when it is outside the first results.
  const selected = findServiceIcon(value);
  if (
    selected &&
    value.startsWith("service:") &&
    !shown.includes(selected) &&
    (!words.length || matches.includes(selected))
  )
    shown.unshift(selected);
  const hidden = Math.max(0, matches.length - SERVICE_RESULT_LIMIT);
  const serviceEntries = shown.map((icon) => ({
    id: "service:" + icon.id,
    value: "service:" + icon.id,
    label: icon.name + " service icon",
    content: <ServiceThumbnail src={serviceIconUrl("service:" + icon.id)} />,
  }));
  const entries = words.length
    ? [...serviceEntries, ...genericEntries]
    : [...genericEntries, ...serviceEntries];
  const [focused, setFocused] = useState(value.replace("builtin:", ""));
  useEffect(() => setFocused(value.replace("builtin:", "")), [value]);
  const active = entries.some(({ id }) => id === focused)
    ? focused
    : entries[0]?.id;
  const root = useRef<HTMLDivElement>(null),
    focusWithin = useRef(false);
  useEffect(() => {
    if (focusWithin.current && document.activeElement === document.body)
      root.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  }, [active, query]);
  return (
    <div
      className="icon-picker"
      role="toolbar"
      aria-label="Bundled icons"
      ref={root}
      onFocusCapture={() => {
        focusWithin.current = true;
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget &&
          !root.current?.contains(event.relatedTarget as Node)
        )
          focusWithin.current = false;
      }}
      onKeyDown={(event) => {
        const index = entries.findIndex(({ id }) => id === active);
        const gridColumns = root.current
          ? getComputedStyle(root.current).gridTemplateColumns
          : "";
        const columns =
          Number(gridColumns.match(/^repeat\(\s*(\d+)\s*,/)?.[1]) ||
          gridColumns.match(/[\d.]+px/g)?.length ||
          (window.innerWidth <= 560 ? 4 : 6);
        let next = index;
        if (event.key === "ArrowRight")
          next = Math.min(index + 1, entries.length - 1);
        else if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
        else if (event.key === "ArrowDown")
          next = Math.min(index + columns, entries.length - 1);
        else if (event.key === "ArrowUp") next = Math.max(index - columns, 0);
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = entries.length - 1;
        else return;
        event.preventDefault();
        const id = entries[next]?.id;
        if (!id) return;
        setFocused(id);
        root.current
          ?.querySelector<HTMLButtonElement>('[data-icon-id="' + id + '"]')
          ?.focus();
      }}
    >
      {entries.map(({ id, value: entryValue, label, content }) => (
        <button
          key={id}
          type="button"
          data-icon-id={id}
          tabIndex={active === id ? 0 : -1}
          aria-label={"Use " + label}
          aria-pressed={value === entryValue}
          title={label}
          onFocus={() => setFocused(id)}
          onClick={() => {
            setFocused(id);
            onChange(entryValue);
          }}
        >
          {content}
          {value === entryValue && <Check className="icon-check" size={10} />}
        </button>
      ))}
      {hidden > 0 && (
        <p className="icon-more">
          {words.length
            ? `${hidden} more matching logos. Refine your search to see them.`
            : `Showing popular services. Search to find all ${serviceIcons.length} logos.`}
        </p>
      )}
      {!entries.length && (
        <p className="icon-empty">No icons found. Try a different keyword.</p>
      )}
    </div>
  );
}
