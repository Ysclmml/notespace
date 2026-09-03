import { useEffect, useRef } from "react";

import { translate } from "../../app/i18n";
import type { usePageFind } from "./usePageFind";
import "./FindBar.css";

export function FindBar({
  find,
  locale = "zh-CN",
}: {
  readonly find: ReturnType<typeof usePageFind>;
  readonly locale?: "zh-CN" | "en-US";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  useEffect(() => {
    if (!find.open) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [find.open, find.request]);
  if (!find.open) return null;

  return (
    <div className="page-find-anchor">
      <section
        aria-label={t("find.currentPage")}
        className="page-find"
        role="search"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            find.close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            find.move(event.shiftKey ? -1 : 1);
          }
        }}
      >
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
      </section>
    </div>
  );
}
