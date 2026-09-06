import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMobileBack } from "./mobileBack";

export interface MobileVisual {
  readonly kind: "image" | "svg";
  readonly title: string;
  readonly source: string;
  readonly width: number;
  readonly height: number;
}

interface Point {
  x: number;
  y: number;
}
interface Viewport extends Point {
  scale: number;
}
const clamp = (scale: number) => Math.max(0.05, Math.min(8, scale));

export function MobileVisualViewer({
  visual,
  onClose,
}: {
  visual: MobileVisual;
  onClose: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const autoFit = useRef(true);
  const current = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const markup = useMemo(() => ({ __html: visual.source }), [visual.source]);
  const update = (value: Viewport) => {
    current.current = value;
    setViewport(value);
  };
  const fit = useCallback(() => {
    const element = stage.current;
    if (!element) return;
    const scale = clamp(
      Math.min(
        (element.clientWidth - 32) / visual.width,
        (element.clientHeight - 32) / visual.height,
      ),
    );
    update({
      scale,
      x: (element.clientWidth - visual.width * scale) / 2,
      y: (element.clientHeight - visual.height * scale) / 2,
    });
  }, [visual.width, visual.height]);
  const zoom = useCallback((factor: number, point?: Point) => {
    const element = stage.current;
    if (!element) return;
    autoFit.current = false;
    const center = point ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    const old = current.current;
    const scale = clamp(old.scale * factor);
    update({
      scale,
      x: center.x - ((center.x - old.x) * scale) / old.scale,
      y: center.y - ((center.y - old.y) * scale) / old.scale,
    });
  }, []);
  useMobileBack(() => {
    onClose();
    return true;
  }, 30);
  useLayoutEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus({ preventScroll: true });
    fit();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [fit]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resized = () => {
      if (autoFit.current) fit();
    };
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(resized) : null;
    observer?.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.002), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", resized);
    return () => {
      observer?.disconnect();
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", resized);
    };
  }, [fit, zoom]);
  return (
    <div
      className="mobile-visual-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={visual.title}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[
          (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        ]?.focus({ preventScroll: true });
      }}
    >
      <header>
        <strong>{visual.title}</strong>
        <span>{Math.round(viewport.scale * 100)}%</span>
        <button ref={close} onClick={onClose} type="button">
          关闭
        </button>
      </header>
      <div
        className="mobile-visual-viewer__stage"
        ref={stage}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          autoFit.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }}
        onPointerMove={(event) => {
          const points = pointers.current;
          const before = points.get(event.pointerId);
          if (!before) return;
          const after = { x: event.clientX, y: event.clientY };
          const other = [...points.entries()].find(([id]) => id !== event.pointerId)?.[1];
          const old = current.current;
          if (other) {
            const distance = Math.hypot(before.x - other.x, before.y - other.y);
            const nextDistance = Math.hypot(after.x - other.x, after.y - other.y);
            const rect = event.currentTarget.getBoundingClientRect();
            const x = (before.x + other.x) / 2 - rect.left;
            const y = (before.y + other.y) / 2 - rect.top;
            const scale =
              distance > 0 ? clamp((old.scale * nextDistance) / distance) : old.scale;
            update({
              scale,
              x: x + (after.x - before.x) / 2 - ((x - old.x) * scale) / old.scale,
              y: y + (after.y - before.y) / 2 - ((y - old.y) * scale) / old.scale,
            });
          } else
            update({
              ...old,
              x: old.x + after.x - before.x,
              y: old.y + after.y - before.y,
            });
          points.set(event.pointerId, after);
        }}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
      >
        <div
          className="mobile-visual-viewer__content"
          style={{
            width: visual.width * viewport.scale,
            height: visual.height * viewport.scale,
            transform: `translate(${viewport.x}px, ${viewport.y}px)`,
          }}
        >
          {visual.kind === "image" ? (
            <img src={visual.source} alt={visual.title} draggable={false} />
          ) : (
            <div dangerouslySetInnerHTML={markup} />
          )}
        </div>
      </div>
      <footer>
        <button type="button" aria-label="缩小图像" onClick={() => zoom(1 / 1.25)}>
          −
        </button>
        <button
          type="button"
          onClick={() => {
            autoFit.current = true;
            fit();
          }}
        >
          适合屏幕
        </button>
        <button type="button" onClick={() => zoom(1 / current.current.scale)}>
          100%
        </button>
        <button type="button" aria-label="放大图像" onClick={() => zoom(1.25)}>
          +
        </button>
        <small>双指缩放 · 单指移动</small>
      </footer>
    </div>
  );
}
