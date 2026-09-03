import { useEffect } from "react";

export function useNativeContextMenuPolicy(confirmationPending: boolean): void {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;
      const allowNativeMenu =
        !confirmationPending &&
        target?.closest('[data-native-context-menu="true"]') &&
        !target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]');

      // Cancel only the browser menu. The same event must still reach each
      // surface's custom context-menu handler, including React portals.
      if (!allowNativeMenu) event.preventDefault();
    };

    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, [confirmationPending]);
}
