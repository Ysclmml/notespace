import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type { PreviewVisual } from "../editor/livePreview";
import { renderMermaidSvg } from "../editor/mermaidRenderer";
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

export function VisualViewer({ visual, onClose }: VisualViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; origin: Point } | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

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
      if (event.key === "Escape") onClose();
      if (event.key === "0") fit();
      if (event.key === "1") actualSize();
      if (event.key === "+" || event.key === "=") {
        setScale((value) => clampScale(value * 1.18));
      }
      if (event.key === "-") setScale((value) => clampScale(value / 1.18));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actualSize, fit, onClose]);

  useEffect(() => {
    if (visual.kind === "image") return;
    let cancelled = false;
    void renderMermaidSvg(visual.source)
      .then((nextSvg) => {
        if (!cancelled) setSvg(nextSvg);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "图表渲染失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visual]);

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
    if (event.button !== 0) return;
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
        <nav aria-label="查看器操作">
          <button aria-label="缩小" onClick={() => zoomBy(1 / 1.18)} type="button">
            −
          </button>
          <button onClick={fit} type="button">
            适合窗口
          </button>
          <button onClick={actualSize} type="button">
            100%
          </button>
          <button aria-label="放大" onClick={() => zoomBy(1.18)} type="button">
            +
          </button>
          <button
            aria-label="关闭查看器"
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
        {error ? (
          <div className="visual-viewer__error">
            <strong>无法渲染图表</strong>
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
              <img alt={visual.title} src={visual.source} onLoad={fit} />
            ) : svg ? (
              <div
                className="visual-viewer__diagram"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <div className="visual-viewer__loading">正在渲染图表…</div>
            )}
          </div>
        )}
      </div>
      <footer>滚轮缩放 · 拖拽平移 · 双击或 0 适合窗口 · 1 显示 100% · Esc 关闭</footer>
    </div>
  );
}
