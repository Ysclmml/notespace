import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { translate } from "../../app/i18n";
import type { AppLocale } from "../../app/settings";
import { applyImageReference, type ImageEditTarget } from "./imageNodeEditing";
import "./ImageReferenceDialog.css";

export function ImageReferenceDialog({
  target,
  locale,
  onClose,
}: {
  readonly target: ImageEditTarget;
  readonly locale: AppLocale;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const helpId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [source, setSource] = useState(String(target.node.attrs.src ?? ""));
  const [alt, setAlt] = useState(String(target.node.attrs.alt ?? ""));
  const [title, setTitle] = useState(String(target.node.attrs.title ?? ""));
  const [error, setError] = useState<"invalid" | "stale" | null>(null);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    sourceRef.current?.focus();
    const keyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        // Preserve ordinary input clipboard/Undo, but never dispatch application
        // navigation, save, close or find shortcuts behind this modal.
        event.stopImmediatePropagation();
        if (!["a", "c", "v", "x", "z", "y"].includes(event.key.toLowerCase()))
          event.preventDefault();
      }
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>("textarea, input, button") ?? [],
        );
        const next = event.shiftKey ? controls.at(-1) : controls[0];
        if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) {
          event.preventDefault();
          next?.focus();
        }
      }
    };
    window.addEventListener("keydown", keyDown, true);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      if (!target.view.isDestroyed && target.view.dom.isConnected) target.view.focus();
    };
  }, [onClose, target]);

  return createPortal(
    <div
      className="image-reference-dialog-layer"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <form
        aria-describedby={helpId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="image-reference-dialog"
        ref={dialogRef}
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const result = applyImageReference(target, { source, alt, title });
          if (result === "applied") onClose();
          else setError(result);
        }}
      >
        <h2 id={titleId}>{t("imageEdit.title")}</h2>
        <p id={helpId}>{t("imageEdit.help")}</p>
        <label>
          {t("imageEdit.source")}
          <textarea
            ref={sourceRef}
            rows={3}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label>
          {t("imageEdit.alt")}
          <input value={alt} onChange={(event) => setAlt(event.target.value)} />
        </label>
        <label>
          {t("imageEdit.tooltip")}
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {error && (
          <p className="image-reference-dialog__error" role="alert">
            {t(error === "invalid" ? "imageEdit.invalidAddress" : "imageEdit.stale")}
          </p>
        )}
        <footer>
          <button onClick={onClose} type="button">
            {t("imageEdit.cancel")}
          </button>
          <button className="image-reference-dialog__apply" type="submit">
            {t("imageEdit.apply")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
