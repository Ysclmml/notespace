import { useEffect, useReducer, useState } from "react";

import type {
  DesktopAdapter,
  DocumentInspection,
} from "../../infrastructure/tauri/desktopAdapter";

export type FavoriteAvailability = DocumentInspection["status"] | "unavailable";

export function useFavoriteAvailability(
  paths: readonly string[],
  visible: boolean,
  inspectPaths: DesktopAdapter["inspectDocuments"],
) {
  const [availability, setAvailability] = useState<
    Readonly<Record<string, FavoriteAvailability>>
  >({});
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!visible || !inspectPaths || paths.length === 0) return;
    let disposed = false;
    let checking = false;
    const inspect = async () => {
      // Focus events may arrive together. Keep one small metadata request in flight.
      if (checking || disposed) return;
      checking = true;
      try {
        const results = await inspectPaths(paths);
        if (disposed) return;
        const statuses = new Map(results.map((result) => [result.path, result.status]));
        setAvailability(
          Object.fromEntries(
            paths.map((path) => [path, statuses.get(path) ?? "unavailable"]),
          ),
        );
      } catch {
        if (!disposed) {
          setAvailability(Object.fromEntries(paths.map((path) => [path, "unavailable"])));
        }
      } finally {
        checking = false;
      }
    };
    const onFocus = () => void inspect();
    void inspect();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [paths, visible, inspectPaths, revision]);

  return { availability, refresh };
}
