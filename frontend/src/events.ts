import type { Application, Session } from "./lib";

/**
 * Application-wide notifications between the API client and the React tree.
 * The window is the transport so the API module stays independent of React;
 * this map is the single place where event names and payloads are declared.
 */
interface HomeGridEvents {
  "homegrid:unauthorized": undefined;
  "homegrid:session-refreshed": Session;
  "homegrid:undo-available": undefined;
  "homegrid:configure-example": Application;
}
type EventName = keyof HomeGridEvents;

export function emit<K extends EventName>(
  name: K,
  ...detail: HomeGridEvents[K] extends undefined ? [] : [HomeGridEvents[K]]
) {
  window.dispatchEvent(
    detail.length
      ? new CustomEvent(name, { detail: detail[0] })
      : new Event(name),
  );
}

/** Subscribes to an event and returns the matching unsubscribe function. */
export function on<K extends EventName>(
  name: K,
  listener: (detail: HomeGridEvents[K]) => void,
) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<HomeGridEvents[K]>).detail);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
