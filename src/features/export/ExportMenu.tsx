import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "../../app/settings";
import type { ExportFormat } from "./ExportDialog";
import "./ExportMenu.css";

export function ExportMenu({
  locale,
  disabled,
  pdfAvailable,
  onSelect,
}: {
  readonly locale: AppLocale;
  readonly disabled: boolean;
  readonly pdfAvailable: boolean;
  readonly onSelect: (format: ExportFormat) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const parentRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const focusFirstRef = useRef(false);
  const zh = locale === "zh-CN";
  // Switching to an ineligible document must also retire an already-open submenu.
  if (disabled && expanded) setExpanded(false);
  useEffect(() => {
    if (expanded && focusFirstRef.current) {
      focusFirstRef.current = false;
      submenuRef.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
    }
  }, [expanded]);
  return (
    <div className="export-menu">
      <button
        ref={parentRef}
        role="menuitem"
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (disabled || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            if (expanded) {
              submenuRef.current
                ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                ?.focus();
            } else {
              focusFirstRef.current = true;
              setExpanded(true);
            }
          }
        }}
      >
        <span>{zh ? "导出" : "Export"}</span>
        <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded && (
        <div
          ref={submenuRef}
          className="export-menu__submenu"
          role="menu"
          aria-label={zh ? "导出格式" : "Export formats"}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();
              event.stopPropagation();
              setExpanded(false);
              parentRef.current?.focus();
            }
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              const buttons = Array.from(
                submenuRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ) ?? [],
              );
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[
                (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          <button role="menuitem" type="button" onClick={() => onSelect("html")}>
            HTML…<small>{zh ? "离线网页" : "Offline page"}</small>
          </button>
          <button
            role="menuitem"
            type="button"
            disabled={!pdfAvailable}
            title={
              pdfAvailable
                ? undefined
                : zh
                  ? "PDF 导出目前支持 macOS"
                  : "PDF export currently supports macOS"
            }
            onClick={() => onSelect("pdf")}
          >
            PDF…<small>{pdfAvailable ? (zh ? "分页文档" : "Paginated") : "macOS"}</small>
          </button>
        </div>
      )}
    </div>
  );
}
