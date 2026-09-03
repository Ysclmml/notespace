import { useState } from "react";
import { useI18n } from "../../app/i18n";
import type { DocumentSession } from "../../app/state";
import "./ExternalChangeBanner.css";

export function ExternalChangeBanner({
  session,
  onReload,
  onOverwrite,
  onSaveAs,
}: {
  session: DocumentSession;
  onReload: () => Promise<void>;
  onOverwrite: () => Promise<void>;
  onSaveAs: () => void;
}) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState<"reload" | "overwrite" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session.externalChange) return null;
  const run = async (action: "reload" | "overwrite") => {
    setConfirmation(null);
    setBusy(true);
    try {
      await (action === "reload" ? onReload() : onOverwrite());
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="external-change-banner" aria-label={t("external.title")}>
      <p role="status">
        {t(
          confirmation
            ? `external.confirm${confirmation === "reload" ? "Reload" : "Overwrite"}`
            : `external.${session.externalChange.status}`,
        )}
      </p>
      <div className="external-change-banner__actions">
        {confirmation ? (
          <>
            <button disabled={busy} onClick={() => setConfirmation(null)} type="button">
              {t("common.cancel")}
            </button>
            <button disabled={busy} onClick={() => void run(confirmation)} type="button">
              {t("common.confirm")}
            </button>
          </>
        ) : (
          <>
            {session.externalChange.status !== "missing" && (
              <button
                disabled={busy}
                onClick={() =>
                  session.dirty ? setConfirmation("reload") : void run("reload")
                }
                type="button"
              >
                {t("external.reload")}
              </button>
            )}
            {session.externalChange.status === "modified" &&
              session.externalChange.revision && (
                <button
                  disabled={busy}
                  onClick={() => setConfirmation("overwrite")}
                  type="button"
                >
                  {t("external.overwrite")}
                </button>
              )}
            <button disabled={busy} onClick={onSaveAs} type="button">
              {t("menu.saveAs")}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
