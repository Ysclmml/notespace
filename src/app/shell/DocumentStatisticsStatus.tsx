import { useEffect, useId, useRef, useState } from "react";

import { useDocumentStatistics } from "../../features/document-statistics/useDocumentStatistics";
import { useI18n } from "../i18n";
import type { DocumentSession } from "../state";
import "./DocumentStatisticsStatus.css";

interface DocumentStatisticsStatusProps {
  readonly session: DocumentSession;
  readonly modeLabel: string;
}

export function DocumentStatisticsStatus({
  session,
  modeLabel,
}: DocumentStatisticsStatusProps) {
  const { locale, t } = useI18n();
  const { statistics, pending } = useDocumentStatistics(session);
  const [expanded, setExpanded] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const formatCount = (count: number | undefined) => count?.toLocaleString(locale) ?? "—";

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target))
        setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [expanded]);

  return (
    <div className="document-statistics" ref={container} aria-live="off">
      <span className="document-statistics__mode">{modeLabel}</span>
      <span aria-hidden="true">·</span>
      <button
        ref={trigger}
        type="button"
        className="document-statistics__trigger"
        aria-label={t("statistics.open")}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        title={t("statistics.open")}
        onClick={() => setExpanded((value) => !value)}
      >
        {pending
          ? t("statistics.updating")
          : t("statistics.count", { count: formatCount(statistics?.wordCount) })}
      </button>
      {expanded && (
        <section
          className="document-statistics__panel"
          id={panelId}
          aria-label={t("statistics.title")}
          aria-busy={pending}
        >
          <h2>{t("statistics.title")}</h2>
          <dl>
            <div>
              <dt>{t("statistics.words")}</dt>
              <dd>{formatCount(statistics?.wordCount)}</dd>
            </div>
            <div>
              <dt>{t("statistics.characters")}</dt>
              <dd>{formatCount(statistics?.characterCount)}</dd>
            </div>
            <div>
              <dt>{t("statistics.charactersWithoutSpaces")}</dt>
              <dd>{formatCount(statistics?.characterCountWithoutSpaces)}</dd>
            </div>
            <div>
              <dt>{t("statistics.lines")}</dt>
              <dd>{formatCount(statistics?.lineCount)}</dd>
            </div>
          </dl>
          <p>{t("statistics.explanation")}</p>
        </section>
      )}
    </div>
  );
}
