import { useContext, useEffect, useRef, useState } from "react";

import { renderMermaidSvg } from "../features/editor/mermaidRenderer";
import { MobileMediaContext } from "./mediaContext";

function useNearViewport() {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver !== "function");
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: element.closest(".mobile-reader__scroller"), rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}

export function MobileImage({
  reference,
  alt,
  linked = false,
}: {
  reference: string;
  alt: string;
  linked?: boolean;
}) {
  const { offline, loadImage, onOpenVisual } = useContext(MobileMediaContext);
  const { ref, visible } = useNearViewport();
  const resource = useRef<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!visible || resource.current || offline) return;
    if (!loadImage) return;
    const controller = new AbortController();
    void loadImage(reference, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        resource.current = url;
        setError(null);
        setSource(url);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : "图片加载失败");
      });
    return () => controller.abort();
  }, [loadImage, offline, reference, retry, visible]);
  useEffect(
    () => () => {
      if (resource.current) URL.revokeObjectURL(resource.current);
    },
    [],
  );
  const image = source && (
    <img
      src={source}
      alt={alt}
      decoding="async"
      draggable={false}
      onError={() => setError("图片无法解码，请检查文件格式")}
    />
  );
  return (
    <span className="mobile-markdown__image" ref={ref}>
      {source && !error ? (
        linked ? (
          image
        ) : (
          <button
            type="button"
            aria-label={`放大图片：${alt || "图片"}`}
            data-mobile-visual-trigger
            onClick={(event) => {
              const image = event.currentTarget.querySelector("img");
              if (image?.naturalWidth && image.naturalHeight)
                onOpenVisual?.({
                  title: alt || "图片",
                  source,
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                  kind: "image",
                });
            }}
          >
            {image}
          </button>
        )
      ) : (
        <span className="mobile-markdown__media-status" role="status">
          <strong>{alt || "图片"}</strong>
          <span>
            {offline
              ? "这张图片未保存在手机，连接电脑后可查看"
              : (error ?? (loadImage ? "正在加载图片…" : "当前连接无法加载图片"))}
          </span>
          {error && !offline && !linked && (
            <button
              type="button"
              onClick={() => {
                if (resource.current) URL.revokeObjectURL(resource.current);
                resource.current = null;
                setSource(null);
                setRetry((value) => value + 1);
              }}
            >
              重试图片
            </button>
          )}
        </span>
      )}
    </span>
  );
}

export function MobileMermaid({ source }: { source: string }) {
  const { onOpenVisual } = useContext(MobileMediaContext);
  const { ref, visible } = useNearViewport();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!visible || source.length > 50_000) return;
    let canceled = false;
    const timeout = setTimeout(() => {
      if (!canceled) setError(true);
      canceled = true;
    }, 8_000);
    void renderMermaidSvg(source)
      .then((result) => {
        if (!canceled) setSvg(result);
      })
      .catch(() => {
        if (!canceled) setError(true);
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      canceled = true;
      clearTimeout(timeout);
    };
  }, [source, visible]);
  return (
    <figure className="mobile-markdown__diagram" aria-label="Mermaid 图表">
      <figcaption>Mermaid 图表</figcaption>
      <span ref={ref}>
        {svg ? (
          <button
            type="button"
            className="mobile-markdown__diagram-image"
            aria-label="放大 Mermaid 图表"
            data-mobile-visual-trigger
            onClick={(event) => {
              const element = event.currentTarget.querySelector("svg");
              const box = element
                ?.getAttribute("viewBox")
                ?.trim()
                .split(/[\s,]+/u)
                .map(Number);
              if (
                box?.length === 4 &&
                box.every(Number.isFinite) &&
                box[2]! > 0 &&
                box[3]! > 0
              ) {
                onOpenVisual?.({
                  title: "Mermaid 图表",
                  kind: "svg",
                  source: svg,
                  width: box[2]!,
                  height: box[3]!,
                });
              }
            }}
          >
            <span dangerouslySetInnerHTML={{ __html: svg }} />
          </button>
        ) : (
          <span className="mobile-markdown__media-status" role="status">
            {error || source.length > 50_000 ? "图表无法渲染，请查看源码" : "正在渲染图表…"}
          </span>
        )}
      </span>
      <details>
        <summary>查看图表源码</summary>
        <MobileCode source={source} language="mermaid" />
      </details>
    </figure>
  );
}

export function MobileCode({
  source,
  language,
}: {
  source: string;
  language?: string | null;
}) {
  const [message, setMessage] = useState("复制代码");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="mobile-markdown__code">
      <div>
        <span>{language || "代码"}</span>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(source);
                setMessage("已复制");
              } catch {
                setMessage("请长按代码复制");
              }
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setMessage("复制代码"), 2000);
            })();
          }}
        >
          {message}
        </button>
      </div>
      <pre>
        <code data-language={language ?? undefined}>{source}</code>
      </pre>
    </div>
  );
}
