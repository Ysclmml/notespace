import { markdownImagePath, resolveMarkdownImageSource } from "../editor/imageSource";
import type { PreviewVisual } from "../viewer/model";

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico)$/iu;
const SCHEME = /^[a-z][a-z\d+.-]*:/iu;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

/** Classify an explicitly opened link without fetching or probing its contents. */
export function imageReferenceFromLink(
  documentPath: string,
  target: string,
  title?: string,
): Extract<PreviewVisual, { kind: "image" }> | null {
  let reference = target.trim();
  if (reference.startsWith("<") && reference.endsWith(">")) {
    reference = reference.slice(1, -1).trim();
  }
  if (!reference || reference.startsWith("#") || hasControlCharacter(reference)) {
    return null;
  }

  let source: string;
  let pathname: string;
  const remote = /^https?:/iu.test(reference);
  if (remote) {
    try {
      const url = new URL(reference);
      pathname = decodePath(url.pathname);
      source = url.href;
    } catch {
      return null;
    }
  } else {
    const decoded = decodePath(reference);
    if (
      hasControlCharacter(decoded) ||
      decoded.startsWith("//") ||
      (SCHEME.test(decoded) &&
        !/^file:/iu.test(reference) &&
        !WINDOWS_ABSOLUTE_PATH.test(decoded))
    ) {
      return null;
    }
    const localPath = markdownImagePath(documentPath, reference);
    if (/^file:/iu.test(reference) && !localPath) return null;
    pathname = localPath ?? decodePath(reference.split(/[?#]/u)[0] ?? "");
    source = reference;
  }

  if (!IMAGE_EXTENSION.test(pathname)) return null;
  if (!remote) source = resolveMarkdownImageSource(documentPath, reference);
  const filename = pathname.split(/[\\/]/u).at(-1) ?? pathname;
  return {
    kind: "image",
    source,
    title: title?.trim() || filename,
    reference,
    documentPath,
  };
}
