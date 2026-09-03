import { useLayoutEffect, useRef } from "react";
import {
  WorkspaceSearchPanel,
  type WorkspaceSearchPanelProps,
} from "./WorkspaceSearchPanel";
import "./WorkspaceSearchDialog.css";

export type WorkspaceSearchDialogProps = Omit<WorkspaceSearchPanelProps, "presentation">;

export function WorkspaceSearchDialog(props: WorkspaceSearchDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="workspace-search-dialog-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) props.onClose();
      }}
    >
      <section
        aria-label={props.locale === "zh-CN" ? "工作区全文搜索" : "Search Workspaces"}
        aria-modal="true"
        className="workspace-search-dialog"
        ref={dialogRef}
        role="dialog"
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const dialog = dialogRef.current;
          const fields = dialog?.querySelectorAll<HTMLElement>(
            'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex="0"]',
          );
          const first = fields?.[0];
          const last = fields?.[fields.length - 1];
          if (!dialog || !first || !last) return;
          const active = document.activeElement;
          if (
            !dialog.contains(active) ||
            (event.shiftKey ? active === first : active === last)
          ) {
            event.preventDefault();
            event.stopPropagation();
            (event.shiftKey ? last : first).focus();
          }
        }}
      >
        <WorkspaceSearchPanel {...props} presentation="dialog" />
      </section>
    </div>
  );
}
