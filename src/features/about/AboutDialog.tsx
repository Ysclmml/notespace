import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../app/i18n";
import { APP_VERSION } from "../../app/version";
import { isAvailableUpdate, type UpdateCheckResult } from "../update/types";
import "./AboutDialog.css";

const repositoryUrl = "https://github.com/Ysclmml/notespace";

export function AboutDialog({
  onClose,
  onOpenExternalUrl,
  onCheckForUpdate,
}: {
  readonly onClose: () => void;
  readonly onOpenExternalUrl?: (url: string) => Promise<void>;
  readonly onCheckForUpdate?: () => Promise<UpdateCheckResult>;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onClose });
  const mounted = useRef(false);
  const openingRef = useRef(false);
  const checkingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

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

  const openUrl = async (url: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setFailed(false);
    try {
      if (!onOpenExternalUrl) throw new Error("External browser unavailable");
      await onOpenExternalUrl(url);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      openingRef.current = false;
      if (mounted.current) setOpening(false);
    }
  };

  const checkLatest = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setCheckFailed(false);
    setUpdateResult(null);
    try {
      if (!onCheckForUpdate) throw new Error("Update checker unavailable");
      const result = await onCheckForUpdate();
      if (mounted.current) setUpdateResult(result);
    } catch {
      if (mounted.current) setCheckFailed(true);
    } finally {
      checkingRef.current = false;
      if (mounted.current) setChecking(false);
    }
  };

  const availableUpdate =
    updateResult && isAvailableUpdate(updateResult) ? updateResult : null;

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
                void openUrl(repositoryUrl);
              }}
              onAuxClick={(event) => {
                event.preventDefault();
                if (event.button === 1) void openUrl(repositoryUrl);
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
          <div className="about-dialog__updates">
            <div className="about-dialog__update-controls">
              <strong>{t("about.currentVersion", { version: APP_VERSION })}</strong>
              <button
                aria-busy={checking}
                className="about-dialog__check"
                disabled={checking}
                onClick={() => void checkLatest()}
                type="button"
              >
                {checking ? t("about.checking") : t("about.checkLatest")}
              </button>
            </div>
            <div
              aria-busy={checking}
              aria-live="polite"
              className="about-dialog__update-status"
            >
              {checking && (
                <p className="about-dialog__update-result" role="status">
                  {t("about.checking")}
                </p>
              )}
              {checkFailed && (
                <p className="about-dialog__error" role="alert">
                  {t("about.checkFailed")}
                </p>
              )}
              {updateResult?.status === "upToDate" && (
                <p className="about-dialog__update-result" role="status">
                  {t("about.upToDate")}
                </p>
              )}
              {updateResult?.status === "noPublishedRelease" && (
                <p className="about-dialog__update-result" role="status">
                  {t("about.noPublishedRelease")}
                </p>
              )}
              {availableUpdate && (
                <div className="about-dialog__update-result" role="status">
                  <span>
                    {t("about.updateAvailable", {
                      version: availableUpdate.latestVersion,
                    })}
                  </span>
                  <button
                    disabled={opening}
                    onClick={() => void openUrl(availableUpdate.releaseUrl)}
                    type="button"
                  >
                    {t("about.openRelease")}
                  </button>
                </div>
              )}
            </div>
          </div>
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
