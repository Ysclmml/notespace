import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { closeHistory } from "@milkdown/kit/prose/history";
import type { EditorView } from "@milkdown/kit/prose/view";
import { isSupportedImageAddress } from "./imageActions";

export interface ImageReferenceDraft {
  readonly source: string;
  readonly alt: string;
  readonly title: string;
}
export interface ImageNodeHandle {
  readonly view: EditorView;
  readonly getPos: () => number | undefined;
}
export interface ImageEditTarget extends ImageNodeHandle {
  readonly element: HTMLImageElement;
  readonly node: ProseMirrorNode;
}
const imageNodes = new WeakMap<HTMLImageElement, ImageNodeHandle>();

export function registerImageNode(
  element: HTMLImageElement,
  handle: ImageNodeHandle,
): () => void {
  imageNodes.set(element, handle);
  return () => imageNodes.delete(element);
}

export function imageEditTarget(
  element: HTMLImageElement,
  view: EditorView,
): ImageEditTarget | null {
  const handle = imageNodes.get(element);
  if (!handle || handle.view !== view || !element.isConnected || view.isDestroyed)
    return null;
  const position = handle.getPos();
  const node = typeof position === "number" ? view.state.doc.nodeAt(position) : null;
  return node?.type.name === "image" ? { ...handle, element, node } : null;
}

export function applyImageReference(
  target: ImageEditTarget,
  draft: ImageReferenceDraft,
): "applied" | "invalid" | "stale" {
  if (!isSupportedImageAddress(draft.source)) return "invalid";
  const current = imageEditTarget(target.element, target.view);
  if (!current || !current.node.eq(target.node)) return "stale";
  const position = current.getPos();
  if (typeof position !== "number") return "stale";
  const attrs = {
    ...current.node.attrs,
    src: draft.source.trim(),
    alt: draft.alt,
    title: draft.title || null,
  };
  if (
    attrs.src === current.node.attrs.src &&
    attrs.alt === current.node.attrs.alt &&
    attrs.title === current.node.attrs.title
  )
    return "applied";
  target.view.dispatch(
    closeHistory(target.view.state.tr.setNodeMarkup(position, undefined, attrs)),
  );
  return "applied";
}
