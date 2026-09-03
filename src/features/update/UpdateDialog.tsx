import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../app/i18n";
import type { AvailableUpdate } from "./types";
import "./UpdateDialog.css";

export function UpdateDialog({
  update,
  onClose,
  onSkip,
  onOpenRelease,
}: {
  readonly update: AvailableUpdate;
  readonly onClose: () => void;
  readonly onSkip: (version: string) => void;
  readonly onOpenRelease: (url: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const laterRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onClose });
  const mounted = useRef(false);
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    callbacks.current = { onClose };
  }, [onClose]);

  useEffect(() => {
    mounted.current = true;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    laterRef.current?.focus();

    const keyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        event.stopImmediatePropagation();
        if (!event.key.toLowerCase().startsWith("c")) event.preventDefault();
      }
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacks.current.onClose();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (
        !dialogRef.current?.contains(document.activeElement) ||
        document.activeElement === (event.shiftKey ? first : last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener("keydown", keyDown, true);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", keyDown, true);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (opening) laterRef.current?.focus();
  }, [opening]);

  const openRelease = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setFailed(false);
    try {
      await onOpenRelease(update.releaseUrl);
      if (mounted.current) onClose();
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      openingRef.current = false;
      if (mounted.current) setOpening(false);
    }
  };

  return createPortal(
    <div
      className="update-dialog-layer"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="update-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <span aria-hidden="true" className="update-dialog__mark">
            ↑
          </span>
          <div>
            <h2 id={titleId}>{t("update.title")}</h2>
            <p id={descriptionId}>{t("update.description")}</p>
          </div>
        </header>
        <div className="update-dialog__versions">
          <span>{t("update.currentVersion", { version: update.currentVersion })}</span>
          <strong>{t("update.latestVersion", { version: update.latestVersion })}</strong>
        </div>
        {failed && (
          <p className="update-dialog__error" role="alert">
            {t("about.openFailed")}
          </p>
        )}
        <footer>
          <button
            disabled={opening}
            onClick={() => {
              onSkip(update.latestVersion);
            }}
            type="button"
          >
            {t("update.skipVersion")}
          </button>
          <button onClick={onClose} ref={laterRef} type="button">
            {t("update.later")}
          </button>
          <button
            aria-busy={opening}
            className="primary-button"
            disabled={opening}
            onClick={() => void openRelease()}
            type="button"
          >
            {t("update.openRelease")}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
