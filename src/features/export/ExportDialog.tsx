import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "../../app/settings";
import "./ExportDialog.css";

export type ExportFormat = "html" | "pdf";

export function ExportDialog({
  locale,
  initialFormat,
  pdfAvailable,
  onClose,
  onExport,
}: {
  readonly locale: AppLocale;
  readonly initialFormat: ExportFormat;
  readonly pdfAvailable: boolean;
  readonly onClose: () => void;
  readonly onExport: (format: ExportFormat, allowRemoteImages: boolean) => void;
}) {
  const [format, setFormat] = useState(initialFormat);
  const [allowRemote, setAllowRemote] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const zh = locale === "zh-CN";
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="settings-dialog-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "导出可分享文档" : "Export shareable document"}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key !== "Tab") return;
          const fields =
            panelRef.current?.querySelectorAll<HTMLElement>("select, input, button");
          const first = fields?.[0],
            last = fields?.[fields.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2>{zh ? "导出可分享文档" : "Export shareable document"}</h2>
        <label className="export-dialog__format">
          {zh ? "格式" : "Format"}
          <select
            value={format}
            onChange={(event) => setFormat(event.currentTarget.value as ExportFormat)}
          >
            <option value="html">HTML</option>
            <option value="pdf" disabled={!pdfAvailable}>
              PDF{pdfAvailable ? "" : zh ? "（目前支持 macOS）" : " (macOS for now)"}
            </option>
          </select>
        </label>
        <p>
          {zh
            ? "包含当前未保存的修改、本地图片和 Mermaid 图表。导出不会保存或修改原文件。"
            : "Includes unsaved edits, local images and Mermaid diagrams. Export does not save or change the source file."}
        </p>
        <label className="export-dialog__remote">
          <input
            type="checkbox"
            checked={allowRemote}
            onChange={(event) => setAllowRemote(event.currentTarget.checked)}
          />
          {zh
            ? "下载并嵌入联网图片（仅本次导出）"
            : "Download and embed online images (this export only)"}
        </label>
        <p className="export-dialog__note">
          {zh
            ? "单文件离线阅读；不打包链接指向的其他文档。图片缺失、过大或图表无法渲染时会提示失败，不输出缺图的分享文件。"
            : "One file for offline reading; linked documents are not bundled. Missing or oversized images and diagram errors stop the export instead of producing an incomplete file."}
        </p>
        <footer>
          <button type="button" onClick={onClose}>
            {zh ? "取消" : "Cancel"}
          </button>
          <button
            className="export-dialog__submit"
            type="button"
            onClick={() => onExport(format, allowRemote)}
          >
            {zh ? "选择保存位置并导出" : "Choose destination and export"}
          </button>
        </footer>
      </section>
    </div>
  );
}
