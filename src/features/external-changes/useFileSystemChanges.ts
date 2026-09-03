import { useEffect, useLayoutEffect, useRef } from "react";

import type { DesktopAdapter } from "../../infrastructure/tauri/desktopAdapter";

const EVENT_DELAY_MS = 250;
const EVENT_MAX_DELAY_MS = 1_000;
const FALLBACK_INTERVAL_MS = 30_000;
const MAX_EVENT_PATHS = 512;
const MAX_PATH_LENGTH = 8_192;
const MAX_EVENT_CHARACTERS = 1_048_576;

// Watch configuration belongs to the window's adapter. Serialize cleanup with
// the next mount too, so a late old invoke cannot clear a newer subscription.
const adapterQueues = new WeakMap<DesktopAdapter, Promise<void>>();

function enqueue(adapter: DesktopAdapter, operation: () => Promise<void>) {
  const next = (adapterQueues.get(adapter) ?? Promise.resolve())
    .then(operation)
    .catch(() => undefined);
  adapterQueues.set(adapter, next);
  void next.then(() => {
    if (adapterQueues.get(adapter) === next) adapterQueues.delete(adapter);
  });
}

function pathSet(paths: readonly string[]): string[] {
  return [...new Set(paths.filter((path) => path.length > 0))].sort();
}

export interface FileSystemChangesOptions {
  readonly adapter: DesktopAdapter | null | undefined;
  readonly workspaceRoots: readonly string[];
  readonly documentPaths: readonly string[];
  /** null requests a complete check of the currently relevant roots/documents. */
  readonly onChange: (paths: readonly string[] | null) => void;
  readonly onError?: (error: unknown) => void;
}

/** Paths only: the caller owns revision inspection and any document reload. */
export function useFileSystemChanges({
  adapter,
  workspaceRoots,
  documentPaths,
  onChange,
  onError,
}: FileSystemChangesOptions): void {
  const callbacksRef = useRef({ onChange, onError });
  const reportedErrorsRef = useRef(new Set<string>());
  // Array identity/order and duplicate tabs do not change the native scope.
  const configuration = JSON.stringify([pathSet(workspaceRoots), pathSet(documentPaths)]);

  useLayoutEffect(() => {
    callbacksRef.current = { onChange, onError };
  }, [onChange, onError]);

  useEffect(() => {
    const watch = adapter?.watchFileSystem;
    const listen = adapter?.listenFileSystemChanges;
    if (!adapter || !watch || !listen) return;
    const [roots, paths] = JSON.parse(configuration) as [string[], string[]];
    if (roots.length === 0 && paths.length === 0) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let configurationQueued = false;
    let watchAttempted = false;
    let initialCheckRequested = false;
    let quietTimer: number | undefined;
    let maximumTimer: number | undefined;
    let pendingAll = false;
    let pendingCharacters = 0;
    const pendingPaths = new Set<string>();

    const reportError = (error: unknown) => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      const reported = reportedErrorsRef.current;
      if (reported.has(message)) return;
      // Keep error deduplication small even if a backend reports varying errors.
      if (reported.size >= 32) reported.delete(reported.values().next().value!);
      reported.add(message);
      callbacksRef.current.onError?.(error);
    };
    const clearBatchTimers = () => {
      window.clearTimeout(quietTimer);
      window.clearTimeout(maximumTimer);
      quietTimer = undefined;
      maximumTimer = undefined;
    };
    const flush = () => {
      clearBatchTimers();
      if (disposed) return;
      const batch = pendingAll ? null : [...pendingPaths];
      pendingAll = false;
      pendingCharacters = 0;
      pendingPaths.clear();
      if (batch?.length === 0) return;
      callbacksRef.current.onChange(batch);
    };
    const requestCheck = (changedPaths: readonly string[] | null) => {
      if (disposed) return;
      if (changedPaths === null || changedPaths.length === 0) pendingAll = true;
      if (!pendingAll && changedPaths) {
        for (const path of changedPaths) {
          if (!path || pendingPaths.has(path)) continue;
          pendingCharacters += path.length;
          if (
            path.length > MAX_PATH_LENGTH ||
            pendingPaths.size >= MAX_EVENT_PATHS ||
            pendingCharacters > MAX_EVENT_CHARACTERS
          ) {
            pendingAll = true;
            break;
          }
          pendingPaths.add(path);
        }
      }
      if (pendingAll) {
        pendingPaths.clear();
        pendingCharacters = 0;
      }
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(flush, EVENT_DELAY_MS);
      maximumTimer ??= window.setTimeout(flush, EVENT_MAX_DELAY_MS);
    };

    const configure = () => {
      if (disposed || configurationQueued) return;
      configurationQueued = true;
      enqueue(adapter, async () => {
        try {
          if (disposed) return;
          if (!unlisten) {
            const stop = await listen.call(adapter, (event) => requestCheck(event.paths));
            if (disposed) {
              stop();
              return;
            }
            unlisten = stop;
          }
          if (disposed) return;
          watchAttempted = true;
          await watch.call(adapter, roots, paths);
        } catch (error) {
          reportError(error);
        } finally {
          configurationQueued = false;
          // A failed watcher still gets an initial inspection plus fallback.
          if (!disposed && !initialCheckRequested) {
            initialCheckRequested = true;
            requestCheck(null);
          }
        }
      });
    };
    const checkAll = () => {
      requestCheck(null);
      configure();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkAll();
    };

    window.addEventListener("focus", checkAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    // Also reconfigure periodically: a deleted/recreated root or parent can
    // invalidate native watches without yielding another useful event.
    const fallbackTimer = window.setInterval(checkAll, FALLBACK_INTERVAL_MS);
    configure();

    return () => {
      disposed = true;
      clearBatchTimers();
      pendingPaths.clear();
      window.clearInterval(fallbackTimer);
      window.removeEventListener("focus", checkAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      enqueue(adapter, async () => {
        try {
          unlisten?.();
        } finally {
          unlisten = undefined;
          if (watchAttempted) await watch.call(adapter, [], []);
        }
      });
    };
  }, [adapter, configuration]);
}
