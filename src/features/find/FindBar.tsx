import { useEffect, useRef } from "react";

import { translate } from "../../app/i18n";
import type { usePageFind } from "./usePageFind";
import "./FindBar.css";

export function FindBar({
  find,
  locale = "zh-CN",
  readOnly = false,
}: {
  readonly find: ReturnType<typeof usePageFind>;
  readonly locale?: "zh-CN" | "en-US";
  readonly readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canReplace = find.canReplace && !readOnly;
  const { replaceOpen, toggleReplace } = find;
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  useEffect(() => {
    if (!find.open) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [find.open, find.request]);
  useEffect(() => {
    if (readOnly && replaceOpen) toggleReplace();
  }, [readOnly, replaceOpen, toggleReplace]);
  if (!find.open) return null;

  return (
    <div className="page-find-anchor">
      <section
        aria-label={t("find.currentPage")}
        className="page-find"
        role="search"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            find.close();
          } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            event.stopPropagation();
            if ((event.target as HTMLElement).dataset.replaceInput === "true") {
              if (canReplace) find.replace(event.shiftKey);
            } else find.move(event.shiftKey ? -1 : 1);
          }
        }}
      >
        <div className="page-find__row">
          {canReplace && (
            <button
              aria-label={t(find.replaceOpen ? "find.hideReplace" : "find.showReplace")}
              aria-expanded={find.replaceOpen}
              onClick={find.toggleReplace}
              type="button"
            >
              {find.replaceOpen ? "⌄" : "›"}
            </button>
          )}
          <input
            aria-label={t("find.currentPage")}
            autoComplete="off"
            onChange={(event) => find.changeQuery(event.target.value)}
            placeholder={t("find.placeholder")}
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={find.query}
          />
          <output aria-live="polite" className="page-find__count">
            {!find.query
              ? t("find.empty")
              : find.total === 0
                ? t("find.noMatches")
                : translate(locale, "find.matchCount", {
                    current: find.current + 1,
                    total: find.total,
                  })}
          </output>
          <button
            aria-label={t("find.previous")}
            disabled={!find.total}
            onClick={() => find.move(-1)}
            title={`${t("find.previous")} (⇧ Enter)`}
            type="button"
          >
            ↑
          </button>
          <button
            aria-label={t("find.next")}
            disabled={!find.total}
            onClick={() => find.move(1)}
            title={`${t("find.next")} (Enter)`}
            type="button"
          >
            ↓
          </button>
          <button
            aria-label={t("find.close")}
            onClick={find.close}
            title={`${t("find.close")} (Esc)`}
            type="button"
          >
            ×
          </button>
        </div>
        {canReplace && find.replaceOpen && (
          <div className="page-find__row">
            <input
              aria-label={t("find.replaceWith")}
              autoComplete="off"
              data-replace-input="true"
              onChange={(event) => find.changeReplacement(event.target.value)}
              placeholder={t("find.replaceWith")}
              spellCheck={false}
              type="text"
              value={find.replacement}
            />
            <button
              className="page-find__replace-button"
              disabled={!find.total}
              onClick={() => find.replace(false)}
              type="button"
            >
              {t("find.replace")}
            </button>
            <button
              className="page-find__replace-button"
              disabled={!find.total}
              onClick={() => find.replace(true)}
              type="button"
            >
              {t("find.replaceAll")}
            </button>
          </div>
        )}
        {canReplace && find.replaceError && (
          <p className="page-find__error" role="alert">
            {t(
              find.replaceError === "composing"
                ? "find.replaceUnavailable"
                : "find.replaceRejected",
            )}
          </p>
        )}
      </section>
    </div>
  );
}
