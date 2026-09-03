import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { useI18n } from "../../app/i18n";
import { renderMermaidSvg } from "../editor/mermaidRenderer";
import type { PreviewVisual } from "./model";
import { isAssetImageSource } from "../image-actions/imageActions";
import "./VisualViewer.css";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface VisualViewerProps {
  readonly visual: PreviewVisual;
  readonly onClose: () => void;
}

const MIN_SCALE = 0.12;
const MAX_SCALE = 8;

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

function contentSize(element: HTMLElement): { width: number; height: number } | null {
  const svg = element.querySelector("svg");
  if (svg) {
    const box = svg.viewBox?.baseVal;
    if (box && box.width > 0 && box.height > 0) {
      return { width: box.width, height: box.height };
    }
    const bounds = svg.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) {
      return { width: bounds.width, height: bounds.height };
    }
  }
  const image = element.querySelector("img");
  if (image?.naturalWidth && image.naturalHeight) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return null;
}

function VisualViewerInstance({ visual, onClose }: VisualViewerProps) {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const hasError = imageFailed || Boolean(error);

  useLayoutEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const size = contentSize(content);
    if (!size) return;
    const padding = 72;
    const nextScale = clampScale(
      Math.min(
        (stage.clientWidth - padding * 2) / size.width,
        (stage.clientHeight - padding * 2) / size.height,
      ),
    );
    setScale(nextScale);
    setOffset({
      x: (stage.clientWidth - size.width * nextScale) / 2,
      y: (stage.clientHeight - size.height * nextScale) / 2,
    });
  }, []);

  const actualSize = useCallback(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;
    const size = contentSize(content);
    if (!size) return;
    setScale(1);
    setOffset({
      x: (stage.clientWidth - size.width) / 2,
      y: (stage.clientHeight - size.height) / 2,
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector(".editor-context-menu")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (hasError) return;
      if (event.key === "0") fit();
      if (event.key === "1") actualSize();
      if (event.key === "+" || event.key === "=") {
        setScale((value) => clampScale(value * 1.18));
      }
      if (event.key === "-") setScale((value) => clampScale(value / 1.18));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actualSize, fit, hasError, onClose]);

  useEffect(() => {
    if (visual.kind === "image") return;
    let cancelled = false;
    void renderMermaidSvg(visual.source)
      .then((nextSvg) => {
        if (!cancelled) setSvg(nextSvg);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : t("viewer.renderFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t, visual]);

  useLayoutEffect(() => {
    if (visual.kind === "mermaid" && !svg) return;
    const frame = window.requestAnimationFrame(fit);
    return () => window.cancelAnimationFrame(frame);
  }, [fit, svg, visual.kind]);

  const zoomBy = (factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const center = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    const next = clampScale(scale * factor);
    const ratio = next / scale;
    setOffset({
      x: center.x - (center.x - offset.x) * ratio,
      y: center.y - (center.y - offset.y) * ratio,
    });
    setScale(next);
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (hasError) return;
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const next = clampScale(scale * Math.exp(-event.deltaY * 0.0015));
    const ratio = next / scale;
    setOffset({
      x: pointer.x - (pointer.x - offset.x) * ratio,
      y: pointer.y - (pointer.y - offset.y) * ratio,
    });
    setScale(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey || hasError) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: offset,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.origin.x + event.clientX - drag.start.x,
      y: drag.origin.y + event.clientY - drag.start.y,
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div
      className="visual-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={visual.title}
    >
      <header className="visual-viewer__toolbar">
        <div>
          <strong>{visual.title}</strong>
          <span>{Math.round(scale * 100)}%</span>
        </div>
        <nav aria-label={t("viewer.actions")}>
          <button
            aria-label={t("viewer.zoomOut")}
            disabled={hasError}
            onClick={() => zoomBy(1 / 1.18)}
            type="button"
          >
            −
          </button>
          <button disabled={hasError} onClick={fit} type="button">
            {t("viewer.fit")}
          </button>
          <button disabled={hasError} onClick={actualSize} type="button">
            {t("viewer.actualSize")}
          </button>
          <button
            aria-label={t("viewer.zoomIn")}
            disabled={hasError}
            onClick={() => zoomBy(1.18)}
            type="button"
          >
            +
          </button>
          <button
            aria-label={t("viewer.close")}
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </nav>
      </header>
      <div
        className="visual-viewer__stage"
        onDoubleClick={fit}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        ref={stageRef}
      >
        {imageFailed ? (
          <div className="visual-viewer__error visual-viewer__error--image" role="status">
            <svg
              aria-hidden="true"
              className="visual-viewer__missing-image"
              viewBox="0 0 48 48"
              fill="none"
            >
              <rect x="6" y="8" width="36" height="32" rx="5" />
              <circle cx="17" cy="18" r="3" />
              <path d="m8 34 11-11 8 8 6-6 8 8M34 4l10 10M44 4 34 14" />
            </svg>
            <strong>{t("viewer.imageLoadFailed")}</strong>
            <span>{t("viewer.imageLoadFailedHint")}</span>
            <code>{visual.source}</code>
          </div>
        ) : error ? (
          <div className="visual-viewer__error">
            <strong>{t("viewer.renderFailed")}</strong>
            <span>{error}</span>
            <pre>{visual.source}</pre>
          </div>
        ) : (
          <div
            className="visual-viewer__content"
            ref={contentRef}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          >
            {visual.kind === "image" ? (
              // SVG files deliberately stay in the browser's inert image mode;
              // never fetch them into innerHTML or mount them as an object/frame.
              <img
                alt={visual.imageAlt ?? visual.title}
                title={visual.imageTitle}
                crossOrigin={isAssetImageSource(visual.source) ? "anonymous" : undefined}
                data-visual-image-source={visual.source}
                data-visual-image-reference={visual.reference ?? visual.source}
                data-visual-image-document={visual.documentPath}
                draggable={false}
                referrerPolicy="no-referrer"
                src={visual.source}
                onError={() => setImageFailed(true)}
                onLoad={fit}
              />
            ) : svg ? (
              <div
                className="visual-viewer__diagram"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <div className="visual-viewer__loading">{t("viewer.rendering")}</div>
            )}
          </div>
        )}
      </div>
      <footer>{t("viewer.instructions")}</footer>
    </div>
  );
}

export function VisualViewer(props: VisualViewerProps) {
  return (
    <VisualViewerInstance {...props} key={`${props.visual.kind}:${props.visual.source}`} />
  );
}
