import { nodeViewCtx } from "@milkdown/kit/core";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { NodeView } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";

/** Keep the stock lazy NodeView, including its off-screen teardown. */
export function stabilizeCodeBlockView(
  native: NodeView,
  initialNode: ProseMirrorNode,
): NodeView {
  const dom = native.dom;
  if (!(dom instanceof HTMLElement)) return native;

  let currentNode = initialNode;
  let measuredHeight: number | undefined;
  let needsMeasurement = true;
  let measureFrame = 0;
  let holdingHeight = false;
  let destroyed = false;
  const originalStyle = {
    height: dom.style.height,
    boxSizing: dom.style.boxSizing,
    overflow: dom.style.overflow,
  };
  const restoreStyle = () => {
    if (!holdingHeight) return;
    holdingHeight = false;
    Object.assign(dom.style, originalStyle);
  };
  const placeholder = () =>
    Boolean(dom.querySelector(":scope > .milkdown-code-block-placeholder"));
  const loadingPreview = () => {
    const source = dom.querySelector(".codemirror-host");
    // Explicitly opening the editable source restores its natural height.
    if (source && !source.classList.contains("hidden")) return false;
    return (
      Boolean(dom.querySelector(".visual-mermaid-preview--loading")) ||
      (String(currentNode.attrs.language ?? "")
        .trim()
        .toLowerCase() === "mermaid" &&
        !dom.querySelector(".visual-mermaid-preview:not(.visual-mermaid-preview--loading)"))
    );
  };
  const synchronizeHeight = () => {
    if (destroyed) return;
    const isPlaceholder = placeholder();
    if (measuredHeight !== undefined && (isPlaceholder || loadingPreview())) {
      holdingHeight = true;
      dom.style.boxSizing = "border-box";
      dom.style.height = `${measuredHeight}px`;
      // A long raw-code placeholder must not overflow its remembered space.
      dom.style.overflow = isPlaceholder ? "clip" : originalStyle.overflow;
    } else {
      restoreStyle();
    }
  };
  const measure = () => {
    synchronizeHeight();
    if (destroyed || !dom.isConnected || placeholder() || loadingPreview()) return;
    const { width, height } = dom.getBoundingClientRect();
    // Detached retained surfaces and placeholders are never new measurements.
    if (width > 0 && height > 0) {
      measuredHeight = height;
      needsMeasurement = false;
    }
  };
  const resize =
    typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
  const mutations = new MutationObserver(() => {
    synchronizeHeight();
    if (needsMeasurement || !resize) measure();
  });
  // Runs before the next layout after the stock view restores its placeholder.
  mutations.observe(dom, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  resize?.observe(dom);

  const update = native.update?.bind(native);
  native.update = (node, decorations, innerDecorations) => {
    if (!node.sameMarkup(currentNode) || !node.content.eq(currentNode.content)) {
      measuredHeight = undefined;
      needsMeasurement = true;
      restoreStyle();
      window.cancelAnimationFrame(measureFrame);
      // An equal-height edit does not produce a ResizeObserver notification.
      measureFrame = window.requestAnimationFrame(measure);
    }
    const accepted = update?.(node, decorations, innerDecorations) ?? false;
    if (accepted) currentNode = node;
    synchronizeHeight();
    return accepted;
  };
  const destroy = native.destroy?.bind(native);
  native.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    mutations.disconnect();
    resize?.disconnect();
    window.cancelAnimationFrame(measureFrame);
    restoreStyle();
    destroy?.();
  };
  return native;
}

// Capture this editor's registered stock factory. The shared codeBlockView.view
// property can already belong to another editor with different configuration.
export const stableCodeBlockView = $view(codeBlockSchema.node, (ctx) => {
  const nodeName = codeBlockSchema.node.type(ctx).name;
  const factory = ctx
    .get(nodeViewCtx)
    .slice()
    .reverse()
    .find(([name]) => name === nodeName)?.[1];
  if (!factory) throw new Error("Install the stock code-block view before its wrapper");
  return (...args) => stabilizeCodeBlockView(factory(...args), args[0]);
});
