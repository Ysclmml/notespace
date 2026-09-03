import { markdownImagePath } from "../editor/imageSource";
import { isOversizedInlineImagePaste } from "../editor/pasteGuard";

export type ImageActionCommand =
  | "previewImage"
  | "copyImage"
  | "copyImageAddress"
  | "copyImageMarkdown"
  | "editImage"
  | "revealImage"
  | "editMermaidSource";

export interface ImageActionTarget {
  readonly kind: "image" | "mermaid";
  readonly element: HTMLImageElement | HTMLElement;
  readonly source: string;
  readonly reference?: string;
  readonly documentPath?: string;
  readonly localPath?: string;
  readonly alt: string;
  readonly title: string;
  readonly editable: boolean;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function resolveImageActionTarget(
  target?: EventTarget | null,
): ImageActionTarget | null {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;
  const mermaid = element?.closest<HTMLElement>(
    ".visual-mermaid-preview, .visual-viewer__diagram",
  );
  if (mermaid) {
    return {
      kind: "mermaid",
      element: mermaid,
      source: "",
      alt: "",
      title: "",
      editable: false,
    };
  }
  const image =
    element?.closest<HTMLImageElement>("img") ??
    element?.closest(".visual-markdown-image")?.querySelector<HTMLImageElement>("img");
  if (!image) return null;
  const reference = image.dataset.visualImageReference ?? image.getAttribute("src") ?? "";
  const documentPath = image.dataset.visualImageDocument;
  const local = !hasControlCharacters(reference)
    ? markdownImagePath(
        documentPath?.startsWith("untitled://") ? "" : (documentPath ?? ""),
        reference,
      )
    : null;
  return {
    kind: "image",
    element: image,
    source:
      image.dataset.visualImageSource ||
      image.currentSrc ||
      image.getAttribute("src") ||
      "",
    reference,
    documentPath,
    localPath:
      local && (/^\//u.test(local) || /^[a-z]:[\\/]/iu.test(local)) ? local : undefined,
    alt: image.alt,
    title: image.getAttribute("title") ?? "",
    editable:
      image.hasAttribute("data-visual-image-reference") &&
      Boolean(image.closest(".ProseMirror")),
  };
}

export function imageMarkdownReference(image: ImageActionTarget): string {
  const alt = image.alt
    .replace(/&/gu, "&amp;")
    .replace(/([\\[\]])/gu, "\\$1")
    .replace(/[\r\n]/gu, " ");
  const source = (image.reference ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/\\/gu, "\\\\")
    .replace(/[<>\r\n]/gu, (character) => encodeURIComponent(character));
  const title = image.title
    .replace(/&/gu, "&amp;")
    .replace(/([\\"])/gu, "\\$1")
    .replace(/[\r\n]/gu, " ");
  return `![${alt}](<${source}>${title ? ` "${title}"` : ""})`;
}

export function isAssetImageSource(source: string): boolean {
  return (
    /^asset:\/\//iu.test(source) || /^https?:\/\/asset\.localhost(?:\/|$)/iu.test(source)
  );
}

/** Validate an edited reference, without loading or probing its resource. */
export function isSupportedImageAddress(value: string): boolean {
  if (isOversizedInlineImagePaste(value)) return false;
  const source = value.trim();
  if (
    !source ||
    hasControlCharacters(source) ||
    source.startsWith("//") ||
    source.startsWith("#")
  )
    return false;
  if (/^https?:/iu.test(source)) {
    try {
      const url = new URL(source);
      return Boolean(url.hostname);
    } catch {
      return false;
    }
  }
  if (/^file:/iu.test(source)) return markdownImagePath("", source) !== null;
  return !/^[a-z][a-z\d+.-]*:/iu.test(source) || /^[a-z]:[\\/]/iu.test(source);
}

/** Copy the already decoded pixels only. No fetch, image reload, or document write. */
export async function copyLoadedImage(image: HTMLImageElement): Promise<boolean> {
  if (
    !image.complete ||
    image.naturalWidth <= 0 ||
    image.naturalHeight <= 0 ||
    image.naturalWidth * image.naturalHeight > 32_000_000 ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  )
    return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(image, 0, 0);
    const pixels = new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed"))),
        "image/png",
      );
    });
    // WebKit requires clipboard.write in the user gesture; encoding may finish later.
    void pixels.catch(() => undefined);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pixels })]);
    return true;
  } catch {
    return false;
  }
}
