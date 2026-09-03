import { renderMermaidSvg } from "./mermaidRenderer";

type MermaidSvgRenderer = (source: string) => Promise<string>;

interface MermaidPreviewMessages {
  readonly open: string;
  readonly renderFailed: string;
  readonly rendering: string;
}

const DEFAULT_MESSAGES: MermaidPreviewMessages = {
  open: "放大查看",
  renderFailed: "图表渲染失败",
  rendering: "正在渲染图表…",
};

interface MermaidPreviewController {
  readonly renderPreview: (language: string, source: string) => null | string;
  readonly sourceFor: (button: HTMLElement) => string | undefined;
  readonly dispose: () => void;
}

function findPreview(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-visual-mermaid-preview-id="${id}"]`);
}

/**
 * Crepe gives each asynchronous preview invocation a new callback, so callback
 * identity cannot be used to reject an older render. This controller instead
 * returns a unique synchronous mount marker. Async work may only update that
 * marker; once a newer source replaces it, the older result becomes inert.
 */
export function createMermaidPreviewController(
  root: HTMLElement,
  isCancelled: () => boolean,
  renderSvg: MermaidSvgRenderer = renderMermaidSvg,
  messages: MermaidPreviewMessages = DEFAULT_MESSAGES,
): MermaidPreviewController {
  let nextId = 1;
  let disposed = false;
  const buttonSources = new WeakMap<HTMLElement, string>();
  const pendingMounts = new Set<() => void>();

  const updateWhenMounted = (id: string, update: (preview: HTMLElement) => void): void => {
    if (disposed || isCancelled()) return;
    const mounted = findPreview(root, id);
    if (mounted) {
      update(mounted);
      return;
    }

    let settled = false;
    const observer = new MutationObserver(() => {
      if (disposed || isCancelled()) {
        stop();
        return;
      }
      const preview = findPreview(root, id);
      if (!preview) return;
      stop();
      update(preview);
    });
    const timeout = window.setTimeout(() => stop(), 5000);
    const stop = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      pendingMounts.delete(stop);
    };

    pendingMounts.add(stop);
    observer.observe(root, { childList: true, subtree: true });
    // Close the small gap between the first lookup and observer registration.
    const preview = findPreview(root, id);
    if (preview) {
      stop();
      update(preview);
    }
  };

  return {
    renderPreview(language, source) {
      if (language.trim().toLowerCase() !== "mermaid") return null;

      const id = `mermaid-${nextId++}`;
      void renderSvg(source)
        .then((svg) => {
          updateWhenMounted(id, (preview) => {
            const canvas = document.createElement("div");
            canvas.className = "visual-mermaid-preview__canvas";
            canvas.innerHTML = svg;

            const open = document.createElement("button");
            open.className = "visual-mermaid-preview__open";
            open.dataset.visualMermaidId = id;
            open.type = "button";
            open.textContent = messages.open;
            buttonSources.set(open, source);

            preview.className = "visual-mermaid-preview";
            preview.replaceChildren(canvas, open);
          });
        })
        .catch((error: unknown) => {
          updateWhenMounted(id, (preview) => {
            const title = document.createElement("strong");
            title.textContent = messages.renderFailed;
            const detail = document.createElement("span");
            detail.textContent =
              error instanceof Error ? error.message : messages.renderFailed;

            preview.className = "visual-mermaid-preview visual-mermaid-preview--error";
            preview.replaceChildren(title, detail);
          });
        });

      return `<section class="visual-mermaid-preview visual-mermaid-preview--loading" data-visual-mermaid-preview-id="${id}">${messages.rendering}</section>`;
    },
    sourceFor(button) {
      return buttonSources.get(button);
    },
    dispose() {
      disposed = true;
      for (const stop of pendingMounts) stop();
      pendingMounts.clear();
    },
  };
}
