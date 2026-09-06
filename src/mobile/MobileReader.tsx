import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { MobileIcon } from "./MobileIcon";
import { mobileMarkdownOutline } from "./markdownModel";
import { SafeMarkdown } from "./SafeMarkdown";
import { MobileVisualViewer, type MobileVisual } from "./MobileVisualViewer";
import { mobileDocumentLink } from "./documentLink";
import { useMobileBack } from "./mobileBack";
import type { MobileDocument, MobileReadPosition, MobileReaderTheme } from "./types";

export interface MobileReaderProps {
  readonly document: MobileDocument;
  readonly initialPosition?: MobileReadPosition;
  readonly initialAnchor?: string;
  readonly loadImage?: (reference: string, signal: AbortSignal) => Promise<Blob>;
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
  initialAnchor,
  loadImage,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [visual, setVisual] = useState<MobileVisual | null>(null);
  const visualReturnPosition = useRef<number | null>(null);
  const visualPointerPosition = useRef<{ top: number; time: number } | null>(null);
  const openVisual = useCallback((next: MobileVisual) => {
    const pointer = visualPointerPosition.current;
    visualReturnPosition.current =
      pointer && Date.now() - pointer.time < 700
        ? pointer.top
        : (scrollerRef.current?.scrollTop ?? 0);
    visualPointerPosition.current = null;
    setVisual(next);
  }, []);
  useLayoutEffect(() => {
    if (visual || visualReturnPosition.current === null) return;
    // Restore only for an explicit viewer close. No scroll listeners or
    // background correction compete with reading gestures.
    if (scrollerRef.current) scrollerRef.current.scrollTop = visualReturnPosition.current;
    visualReturnPosition.current = null;
  }, [visual]);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const openLinkRef = useRef(onOpenLink);
  useLayoutEffect(() => {
    openLinkRef.current = onOpenLink;
  }, [onOpenLink]);
  const tapRef = useRef<{
    id: number;
    x: number;
    y: number;
    time: number;
    scrollTop: number;
  } | null>(null);
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

  const jumpToHeading = useCallback((id: string) => {
    const target = scrollerRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    target?.scrollIntoView({ block: "start" });
    if (!target) setLinkNotice("文档中未找到这个标题或位置");
    setOutlineOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!initialAnchor) return;
    scrollerRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(initialAnchor)}`)
      ?.scrollIntoView({ block: "start" });
  }, [initialAnchor]);

  const openLink = useCallback(
    (href: string) => {
      setLinkNotice(null);
      try {
        const link = mobileDocumentLink(document.relativePath, href);
        if (link.relativePath === document.relativePath) {
          if (link.anchor) jumpToHeading(link.anchor);
          else scrollerRef.current?.scrollTo({ top: 0 });
        } else {
          publishPendingPosition();
          openLinkRef.current?.(href);
        }
      } catch (reason) {
        setLinkNotice(reason instanceof Error ? reason.message : "无法打开链接");
      }
    },
    [document.relativePath, jumpToHeading, publishPendingPosition],
  );

  const goBack = () => {
    publishPendingPosition();
    onBack();
  };
  useMobileBack(() => {
    if (outlineOpen) setOutlineOpen(false);
    else if (settingsOpen) setSettingsOpen(false);
    else if (menuOpen) setMenuOpen(false);
    else goBack();
    return true;
  }, 10);

  return (
    <section className="mobile-reader" data-theme={theme}>
      <div className="mobile-reader__chrome" inert={visual !== null}>
        <header className="mobile-reader__header">
          <button
            aria-label="返回"
            className="mobile-icon-button"
            onClick={goBack}
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
            aria-expanded={menuOpen}
            aria-label="阅读菜单"
            className="mobile-icon-button"
            onClick={() => setMenuOpen((current) => !current)}
            type="button"
          >
            <MobileIcon name="outline" />
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
        {(notice || linkNotice) && (
          <div className="mobile-notice" role="status">
            <span>{linkNotice || notice}</span>
            {(onDismissNotice || linkNotice) && (
              <button
                onClick={() => {
                  setLinkNotice(null);
                  onDismissNotice?.();
                }}
                type="button"
              >
                知道了
              </button>
            )}
          </div>
        )}
      </div>

      {outlineOpen && (
        <aside
          aria-label="文档大纲"
          className="mobile-reader__outline"
          inert={visual !== null}
        >
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
        inert={visual !== null}
        onPointerDownCapture={(event) => {
          if ((event.target as Element).closest("[data-mobile-visual-trigger]")) {
            visualPointerPosition.current = {
              top: event.currentTarget.scrollTop,
              time: Date.now(),
            };
          } else {
            visualPointerPosition.current = null;
          }
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            tapRef.current ||
            globalThis.getSelection()?.isCollapsed === false ||
            (event.target as Element).closest("button,a,input,summary,pre,table")
          ) {
            tapRef.current = null;
            return;
          }
          tapRef.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            time: Date.now(),
            scrollTop: event.currentTarget.scrollTop,
          };
        }}
        onPointerCancel={() => {
          tapRef.current = null;
        }}
        onPointerUp={(event) => {
          const tap = tapRef.current;
          tapRef.current = null;
          if (
            !tap ||
            tap.id !== event.pointerId ||
            Date.now() - tap.time > 350 ||
            Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8 ||
            Math.abs(event.currentTarget.scrollTop - tap.scrollTop) > 4 ||
            globalThis.getSelection()?.isCollapsed === false
          )
            return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const y = event.clientY - bounds.top;
          if (y >= bounds.height / 3 && y <= (bounds.height * 2) / 3) {
            setMenuOpen((open) => !open);
            setOutlineOpen(false);
            setSettingsOpen(false);
          }
        }}
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
        <SafeMarkdown
          markdown={document.markdown}
          onOpenLink={openLink}
          loadImage={loadImage}
          offline={offline}
          onOpenVisual={openVisual}
        />
        <footer className="mobile-reader__end">已读到 {progressLabel(progress)}</footer>
      </main>
      {menuOpen && (
        <nav
          className="mobile-reader__bottom-menu"
          aria-label="阅读菜单"
          inert={visual !== null}
        >
          <button type="button" onClick={goBack}>
            返回列表
          </button>
          <button
            type="button"
            aria-label="文档大纲"
            aria-expanded={outlineOpen}
            disabled={!outline.length}
            onClick={() => {
              setSettingsOpen(false);
              setOutlineOpen((open) => !open);
            }}
          >
            大纲
          </button>
          <button
            type="button"
            aria-label="阅读设置"
            aria-expanded={settingsOpen}
            onClick={() => {
              setOutlineOpen(false);
              setSettingsOpen((open) => !open);
            }}
          >
            Aa 设置
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setOutlineOpen(false);
              setSettingsOpen(false);
            }}
          >
            收起
          </button>
        </nav>
      )}
      {visual && <MobileVisualViewer visual={visual} onClose={() => setVisual(null)} />}
      <div aria-hidden="true" className="mobile-reader__progress">
        <span style={{ width: progressLabel(progress) }} />
      </div>
    </section>
  );
}
