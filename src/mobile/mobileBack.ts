import { useLayoutEffect, useRef } from "react";

const BACK_EVENT = "notespace-mobile-back";
const handlers = new Set<{ priority: number; handle: () => boolean }>();

/** Returns true only when the reader consumed Back. Android owns root exit. */
export function dispatchMobileBack(): boolean {
  return [...handlers]
    .sort((a, b) => b.priority - a.priority)
    .some(({ handle }) => handle());
}

function onNativeBack(event: Event) {
  if (dispatchMobileBack()) event.preventDefault();
}

function onEscape(event: KeyboardEvent) {
  if (event.key === "Escape" && dispatchMobileBack()) event.preventDefault();
}

export function useMobileBack(handle: () => boolean, priority = 0) {
  const current = useRef(handle);
  useLayoutEffect(() => {
    current.current = handle;
  });
  useLayoutEffect(() => {
    const entry = { priority, handle: () => current.current() };
    if (handlers.size === 0) {
      window.addEventListener(BACK_EVENT, onNativeBack);
      window.addEventListener("keydown", onEscape);
    }
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
      if (handlers.size === 0) {
        window.removeEventListener(BACK_EVENT, onNativeBack);
        window.removeEventListener("keydown", onEscape);
      }
    };
  }, [priority]);
}
