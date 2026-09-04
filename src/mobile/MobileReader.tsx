import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MobileIcon } from "./MobileIcon";
import { mobileMarkdownOutline } from "./markdownModel";
import { SafeMarkdown } from "./SafeMarkdown";
import type { MobileDocument, MobileReadPosition, MobileReaderTheme } from "./types";

export interface MobileReaderProps {
  readonly document: MobileDocument;
  readonly initialPosition?: MobileReadPosition;
  readonly offline?: boolean;
  readonly offlineNotice?: {
    readonly title: string;
    readonly detail: string;
  };
  readonly notice?: string | null;
  readonly onBack: () => void;
  readonly onDismissNotice?: () => void;
  readonly onOpenLink?: (href: string) => void;
  readonly onPositionChange: (position: MobileReadPosition) => void;
  readonly onReconnect?: () => void;
}

function progressLabel(progress: number) {
  return `${Math.round(progress * 100)}%`;
}

export function MobileReader({
  document,
  initialPosition,
  offline = false,
  offlineNotice,
  notice,
  onBack,
  onDismissNotice,
  onOpenLink,
  onPositionChange,
  onReconnect,
}: MobileReaderProps) {
  const scrollerRef = useRef<HTMLElement>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [theme, setTheme] = useState<MobileReaderTheme>("paper");
  const [progress, setProgress] = useState(initialPosition?.progress ?? 0);
  const restoredDocumentRef = useRef<string | null>(null);
  const lastPublishedAtRef = useRef(0);
  const pendingPositionRef = useRef<MobileReadPosition | null>(null);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outline = useMemo(
    () => mobileMarkdownOutline(document.markdown),
    [document.markdown],
  );
  const attachScroller = useCallback(
    (element: HTMLElement | null) => {
      scrollerRef.current = element;
      if (element && restoredDocumentRef.current !== document.id) {
        element.scrollTop = initialPosition?.scrollTop ?? 0;
        restoredDocumentRef.current = document.id;
      }
    },
    [document.id, initialPosition?.scrollTop],
  );

  const publishPendingPosition = useCallback(() => {
    if (publishTimerRef.current) {
      clearTimeout(publishTimerRef.current);
      publishTimerRef.current = null;
    }
    const pending = pendingPositionRef.current;
    if (!pending) return;
    pendingPositionRef.current = null;
    lastPublishedAtRef.current = Date.now();
    onPositionChange(pending);
  }, [onPositionChange]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (globalThis.document.visibilityState === "hidden") publishPendingPosition();
    };
    globalThis.document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      globalThis.document.removeEventListener("visibilitychange", onVisibilityChange);
      publishPendingPosition();
    };
  }, [publishPendingPosition]);

  const rememberPosition = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const available = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextProgress = available === 0 ? 0 : Math.min(1, scroller.scrollTop / available);
    const nextPosition = {
      scrollTop: Math.max(0, scroller.scrollTop),
      progress: nextProgress,
      updatedAt: new Date().toISOString(),
    };
    pendingPositionRef.current = nextPosition;
    if (Math.abs(progress - nextProgress) >= 0.005) setProgress(nextProgress);

    const remaining = Math.max(0, 250 - (Date.now() - lastPublishedAtRef.current));
    if (remaining === 0) {
      publishPendingPosition();
    } else if (!publishTimerRef.current) {
      publishTimerRef.current = setTimeout(publishPendingPosition, remaining);
    }
  };

  const jumpToHeading = (id: string) => {
    const target = scrollerRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ block: "start" });
    setOutlineOpen(false);
  };

  return (
    <section className="mobile-reader" data-theme={theme}>
      <div className="mobile-reader__chrome">
        <header className="mobile-reader__header">
          <button
            aria-label="返回"
            className="mobile-icon-button"
            onClick={() => {
              publishPendingPosition();
              onBack();
            }}
            type="button"
          >
            <MobileIcon name="back" />
          </button>
          <div className="mobile-reader__title">
            <strong>{document.title}</strong>
            <span>{document.workspaceName}</span>
          </div>
          {offline && (
            <button
              aria-label={onReconnect ? "离线，重新连接电脑" : "离线"}
              className="mobile-reader__offline-status"
              disabled={!onReconnect}
              onClick={onReconnect}
              type="button"
            >
              <MobileIcon name="disconnect" size={14} />
              <span>离线</span>
            </button>
          )}
          <button
            aria-expanded={outlineOpen}
            aria-label="文档大纲"
            className="mobile-icon-button"
            disabled={outline.length === 0}
            onClick={() => {
              setSettingsOpen(false);
              setOutlineOpen((current) => !current);
            }}
            type="button"
          >
            <MobileIcon name="outline" />
          </button>
          <button
            aria-expanded={settingsOpen}
            aria-label="阅读设置"
            className="mobile-icon-button mobile-reader__text-button"
            onClick={() => {
              setOutlineOpen(false);
              setSettingsOpen((current) => !current);
            }}
            type="button"
          >
            Aa
          </button>
        </header>

        {settingsOpen && (
          <div aria-label="阅读设置" className="mobile-reader__settings">
            <div className="mobile-reader__font-controls">
              <span>字号</span>
              <button
                aria-label="缩小字号"
                disabled={fontScale <= 0.9}
                onClick={() => setFontScale((value) => Math.max(0.9, value - 0.1))}
                type="button"
              >
                A−
              </button>
              <span>{Math.round(fontScale * 100)}%</span>
              <button
                aria-label="放大字号"
                disabled={fontScale >= 1.3}
                onClick={() => setFontScale((value) => Math.min(1.3, value + 0.1))}
                type="button"
              >
                A+
              </button>
            </div>
            <div aria-label="阅读主题" className="mobile-reader__themes" role="group">
              {(
                [
                  ["paper", "纸白"],
                  ["sepia", "柔黄"],
                  ["dark", "深色"],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-pressed={theme === value}
                  key={value}
                  onClick={() => setTheme(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {offline && offlineNotice && (
          <div
            className="mobile-offline-banner mobile-offline-banner--transient"
            role="status"
          >
            <MobileIcon name="disconnect" size={17} />
            <span>
              <strong>{offlineNotice.title}</strong>
              <small>{offlineNotice.detail}</small>
            </span>
          </div>
        )}
        {notice && (
          <div className="mobile-notice" role="status">
            <span>{notice}</span>
            {onDismissNotice && (
              <button onClick={onDismissNotice} type="button">
                知道了
              </button>
            )}
          </div>
        )}
      </div>

      {outlineOpen && (
        <aside aria-label="文档大纲" className="mobile-reader__outline">
          <div className="mobile-reader__outline-heading">
            <strong>文档大纲</strong>
            <button onClick={() => setOutlineOpen(false)} type="button">
              完成
            </button>
          </div>
          <nav>
            {outline.map((item) => (
              <button
                key={item.id}
                onClick={() => jumpToHeading(item.id)}
                style={{ paddingInlineStart: `${16 + (item.depth - 1) * 14}px` }}
                type="button"
              >
                {item.text}
              </button>
            ))}
          </nav>
        </aside>
      )}

      <main
        className="mobile-reader__scroller"
        data-testid="mobile-reader-scroller"
        onScroll={rememberPosition}
        ref={attachScroller}
        style={{ "--mobile-reader-scale": fontScale } as React.CSSProperties}
      >
        <div className="mobile-reader__meta">
          <span>{document.relativePath}</span>
          {document.updatedAt && (
            <time dateTime={document.updatedAt}>磁盘内容 · {document.updatedAt}</time>
          )}
        </div>
        <SafeMarkdown markdown={document.markdown} onOpenLink={onOpenLink} />
        <footer className="mobile-reader__end">已读到 {progressLabel(progress)}</footer>
      </main>
      <div aria-hidden="true" className="mobile-reader__progress">
        <span style={{ width: progressLabel(progress) }} />
      </div>
    </section>
  );
}
