/**
 * Only detect the clipboard representation here. The desktop host reads the
 * pixels, so WebKit does not need to expose a File or image bytes to JavaScript.
 */
export type ClipboardImagePasteKind = "image" | "native-fallback";

/** A saved image awaiting insertion into a document remounted after Save As. */
export interface EditorImageInsertRequest {
  readonly id: number;
  readonly documentId: string;
  readonly editorMode: "visual" | "source";
  readonly markdown: string;
  readonly expectedText: string;
  readonly selection: { readonly from: number; readonly to: number };
}

const imageFileName = /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|ico|svg)$/i;

function isImageOnlyHtml(html: string): boolean {
  // Template contents are inert: examining a clipboard image wrapper must not
  // load its URL, execute its markup, or place its data URI in the editor.
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["IMG", "DIV", "P", "SPAN", "BR", "META"]);
  if (
    Array.from(template.content.querySelectorAll("*")).some(
      (element) => !allowedTags.has(element.tagName),
    )
  ) {
    return false;
  }
  const images = template.content.querySelectorAll("img");
  return (
    images.length === 1 &&
    !!images[0]?.getAttribute("src")?.trim() &&
    !template.content.textContent?.replace(/\uFFFC/g, "").trim()
  );
}

export function clipboardImagePasteKind(
  data: DataTransfer | null,
): ClipboardImagePasteKind | null {
  if (!data) return null;

  const items = Array.from(data.items ?? []);
  const files = Array.from(data.files ?? []);
  const types = Array.from(data.types ?? []).map((type) => type.toLowerCase());
  const isImageType = (type: string) => type.toLowerCase().startsWith("image/");
  const isImageFile = (file: File) =>
    isImageType(file.type) || (!file.type && imageFileName.test(file.name ?? ""));

  // A real, exposed non-image file should never be swallowed by image paste.
  // An empty item MIME, unlike application/pdf etc., says nothing about its
  // contents; WebKit may still expose the matching image through files/types.
  if (
    files.some((file) => !isImageFile(file)) ||
    items.some((item) => item.kind === "file" && !!item.type && !isImageType(item.type))
  ) {
    return null;
  }
  const hasImage =
    items.some((item) => isImageType(item.type)) ||
    files.some(isImageFile) ||
    types.some(isImageType);

  const text = data.getData("text/plain");
  const html = data.getData("text/html");
  // Keep actual text, rich documents and copied file paths on their usual
  // path. A lone image's HTML/whitespace/object-placeholder representation is
  // not text content and must not mask its advertised PNG/TIFF representation.
  if (
    data.getData("text/uri-list") !== "" ||
    (text !== "" && (!hasImage || !!text.replace(/\uFFFC/g, "").trim())) ||
    (html !== "" && (!hasImage || !isImageOnlyHtml(html)))
  ) {
    return null;
  }
  if (hasImage) return "image";

  // Some native screenshot providers expose only "Files", or no browser
  // payload at all. Try the native reader only when no other paste can be lost.
  // Callers must additionally require an available desktop image callback.
  return items.length === 0 && files.length === 0 && types.every((type) => type === "files")
    ? "native-fallback"
    : null;
}
