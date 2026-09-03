import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../app/i18n";
import "./AboutDialog.css";

const repositoryUrl = "https://github.com/Ysclmml/notespace";

export function AboutDialog({
  onClose,
  onOpenExternalUrl,
}: {
  readonly onClose: () => void;
  readonly onOpenExternalUrl?: (url: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
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
    closeRef.current?.focus();

    const keyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        event.stopImmediatePropagation();
        if (!["a", "c"].includes(event.key.toLowerCase())) event.preventDefault();
      }
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacks.current.onClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button") ?? [],
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
      }
    };
    window.addEventListener("keydown", keyDown, true);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", keyDown, true);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  const openRepository = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setFailed(false);
    try {
      if (!onOpenExternalUrl) throw new Error("External browser unavailable");
      await onOpenExternalUrl(repositoryUrl);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      openingRef.current = false;
      if (mounted.current) setOpening(false);
    }
  };

  return createPortal(
    <div
      className="about-dialog-layer"
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
        className="about-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <h2 id={titleId}>{t("about.title")}</h2>
        </header>
        <div className="about-dialog__body">
          <p className="about-dialog__name">NoteSpace</p>
          <p id={descriptionId}>{t("about.description")}</p>
          <div className="about-dialog__repository">
            <strong>{t("about.repository")}</strong>
            <a
              aria-busy={opening}
              aria-disabled={opening || undefined}
              href={repositoryUrl}
              onClick={(event) => {
                event.preventDefault();
                void openRepository();
              }}
              onAuxClick={(event) => {
                event.preventDefault();
                if (event.button === 1) void openRepository();
              }}
              title={t("about.openRepository")}
            >
              {repositoryUrl}
            </a>
            <small>{t("about.openRepository")}</small>
          </div>
          {failed && (
            <p className="about-dialog__error" role="alert">
              {t("about.openFailed")}
            </p>
          )}
        </div>
        <footer>
          <button onClick={onClose} ref={closeRef} type="button">
            {t("common.close")}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
