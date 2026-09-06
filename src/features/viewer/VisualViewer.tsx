import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useI18n } from "../../app/i18n";
import { markdownImagePath, prepareMarkdownImageSource } from "../editor/imageSource";
import { renderMermaidSvg } from "../editor/mermaidRenderer";
import type { PreviewVisual } from "./model";
import { isAssetImageSource } from "../image-actions/imageActions";
import "./VisualViewer.css";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Viewport {
  readonly scale: number;
  readonly offset: Point;
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

function contentSize(element: HTMLElement): Size | null {
  const svg = element.querySelector("svg");
  if (svg) {
    const box = svg.viewBox?.baseVal;
    if (box && box.width > 0 && box.height > 0) {
      return { width: box.width, height: box.height };
    }
    const viewBox = svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/u)
      .map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
      const [, , width, height] = viewBox as [number, number, number, number];
      if (width > 0 && height > 0) return { width, height };
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
  const imageReference = visual.kind === "image" ? visual.reference : undefined;
  const documentPath = visual.kind === "image" ? visual.documentPath : undefined;
  const prepareLocalImage =
    imageReference !== undefined &&
    documentPath !== undefined &&
    markdownImagePath(documentPath, imageReference) !== null;
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);
  const sizeRef = useRef<Size | null>(null);
  const autoFitRef = useRef(true);
  const [svg, setSvg] = useState<string | null>(null);
  const svgMarkup = useMemo(() => ({ __html: svg ?? "" }), [svg]);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageSource, setImageSource] = useState<string | null>(() =>
    visual.kind === "image" && !prepareLocalImage ? visual.source : null,
  );
  const [size, setSize] = useState<Size | null>(null);
  const [{ scale, offset }, setViewport] = useState<Viewport>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });
  const hasError = imageFailed || Boolean(error);

  useLayoutEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const fitSize = useCallback((size: Size | null) => {
    const stage = stageRef.current;
    if (!stage || !size || stage.clientWidth <= 0 || stage.clientHeight <= 0) return;
    const padding = 72;
    const nextScale = clampScale(
      Math.min(
        (stage.clientWidth - padding * 2) / size.width,
        (stage.clientHeight - padding * 2) / size.height,
      ),
    );
    setViewport({
      scale: nextScale,
      offset: {
        x: (stage.clientWidth - size.width * nextScale) / 2,
        y: (stage.clientHeight - size.height * nextScale) / 2,
      },
    });
  }, []);

  const fit = useCallback(() => {
    autoFitRef.current = true;
    fitSize(sizeRef.current);
  }, [fitSize]);

  const measureContent = useCallback(() => {
    const content = contentRef.current;
    const nextSize = content && contentSize(content);
    if (!nextSize) return;
    const previous = sizeRef.current;
    if (previous?.width === nextSize.width && previous.height === nextSize.height) return;
    sizeRef.current = nextSize;
    setSize(nextSize);
    if (autoFitRef.current) fitSize(nextSize);
  }, [fitSize]);

  const actualSize = useCallback(() => {
    const stage = stageRef.current;
    const size = sizeRef.current;
    if (!stage || !size) return;
    autoFitRef.current = false;
    setViewport({
      scale: 1,
      offset: {
        x: (stage.clientWidth - size.width) / 2,
        y: (stage.clientHeight - size.height) / 2,
      },
    });
  }, []);

  const zoomBy = useCallback((factor: number, pointer?: Point) => {
    const stage = stageRef.current;
    if (!stage || !sizeRef.current) return;
    autoFitRef.current = false;
    const center = pointer ?? { x: stage.clientWidth / 2, y: stage.clientHeight / 2 };
    setViewport(({ scale, offset }) => {
      const next = clampScale(scale * factor);
      const ratio = next / scale;
      return {
        scale: next,
        offset: {
          x: center.x - (center.x - offset.x) * ratio,
          y: center.y - (center.y - offset.y) * ratio,
        },
      };
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector(".editor-context-menu")) return;
      if (event.key === "Tab") {
        const buttons = Array.from(
          actionsRef.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        if (!buttons.length) return;
        const current = buttons.findIndex((button) => button === document.activeElement);
        const next =
          current < 0
            ? event.shiftKey
              ? buttons.length - 1
              : 0
            : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        // Focusing a covered editor control can scroll the document behind the
        // viewer. Keep keyboard navigation inside this dialog until it closes.
        event.preventDefault();
        buttons[next]?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (hasError || event.metaKey || event.ctrlKey || event.altKey || event.isComposing)
        return;
      if (event.key === "0") fit();
      if (event.key === "1") actualSize();
      if (event.key === "+" || event.key === "=") zoomBy(1.18);
      if (event.key === "-") zoomBy(1 / 1.18);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actualSize, fit, hasError, onClose, zoomBy]);

  useEffect(() => {
    if (!prepareLocalImage || imageReference === undefined || documentPath === undefined)
      return;
    let cancelled = false;
    void prepareMarkdownImageSource(documentPath, imageReference)
      .then((source) => {
        if (!cancelled) setImageSource(source);
      })
      .catch(() => {
        if (!cancelled) setImageFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [documentPath, imageReference, prepareLocalImage]);

  useEffect(() => {
    if (visual.kind !== "mermaid") return;
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
  }, [t, visual.kind, visual.source]);

  useLayoutEffect(() => {
    if (svg) measureContent();
  }, [measureContent, svg]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let width = stage.clientWidth;
    let height = stage.clientHeight;
    const onResize = () => {
      if (width === stage.clientWidth && height === stage.clientHeight) return;
      width = stage.clientWidth;
      height = stage.clientHeight;
      if (autoFitRef.current) fitSize(sizeRef.current);
    };
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
    observer?.observe(stage);
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [fitSize]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (hasError) return;
      const bounds = stage.getBoundingClientRect();
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      zoomBy(Math.exp(-event.deltaY * unit * 0.0015), {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    };
    // React delegates wheel listeners as passive, so preventDefault there
    // cannot stop the same gesture from scrolling/zooming the underlying page.
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [hasError, zoomBy]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey || hasError) return;
    autoFitRef.current = false;
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
    const x = drag.origin.x + event.clientX - drag.start.x;
    const y = drag.origin.y + event.clientY - drag.start.y;
    setViewport((value) => ({ ...value, offset: { x, y } }));
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
        <nav aria-label={t("viewer.actions")} ref={actionsRef}>
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
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px)`,
              width: size ? size.width * scale : undefined,
              height: size ? size.height * scale : undefined,
            }}
          >
            {visual.kind === "image" && imageSource ? (
              // SVG files deliberately stay in the browser's inert image mode;
              // never fetch them into innerHTML or mount them as an object/frame.
              <img
                alt={visual.imageAlt ?? visual.title}
                title={visual.imageTitle}
                crossOrigin={isAssetImageSource(imageSource) ? "anonymous" : undefined}
                data-visual-image-source={imageSource}
                data-visual-image-reference={visual.reference ?? visual.source}
                data-visual-image-document={visual.documentPath}
                draggable={false}
                referrerPolicy="no-referrer"
                src={imageSource}
                onError={() => setImageFailed(true)}
                onLoad={measureContent}
              />
            ) : svg ? (
              <div className="visual-viewer__diagram" dangerouslySetInnerHTML={svgMarkup} />
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
  const { visual } = props;
  return (
    <VisualViewerInstance
      {...props}
      key={JSON.stringify([
        visual.kind,
        visual.source,
        visual.kind === "image" ? visual.documentPath : null,
        visual.kind === "image" ? visual.reference : null,
      ])}
    />
  );
}
