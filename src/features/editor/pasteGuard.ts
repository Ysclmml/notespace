export const LARGE_PASTE_TEXT_THRESHOLD = 1024 * 1024;

const inlineImageMarker = /data:image\/[a-z0-9.+-]+;base64,/i;

export function isOversizedInlineImagePaste(
  text: string,
  threshold = LARGE_PASTE_TEXT_THRESHOLD,
): boolean {
  return text.length > threshold && inlineImageMarker.test(text);
}
