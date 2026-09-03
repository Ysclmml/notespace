import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";

export interface EditorSemanticPosition {
  /** Stable fallback when the surrounding text cannot be matched exactly. */
  readonly progress: number;
  /** Nearest section heading, when one exists. */
  readonly headingText?: string;
  /** A short plain-text needle around the visible selection or viewport. */
  readonly text?: string;
  /** Caret offset within `text`. */
  readonly textOffset?: number;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/u, "")
    .replace(/\s+#+\s*$/u, "")
    .replace(/[`*_~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function nearbyText(value: string, offset: number): { text?: string; textOffset?: number } {
  const normalizedOffset = Math.max(0, Math.min(offset, value.length));
  const radius = 32;
  let start = Math.max(0, normalizedOffset - radius);
  let end = Math.min(value.length, normalizedOffset + radius);

  while (start < normalizedOffset && /\s/u.test(value[start] ?? "")) start += 1;
  while (end > normalizedOffset && /\s/u.test(value[end - 1] ?? "")) end -= 1;
  const text = value.slice(start, end).replace(/\s+/gu, " ").trim();
  if (!text) return {};

  const prefix = value.slice(start, normalizedOffset).replace(/\s+/gu, " ");
  return { text, textOffset: Math.min(prefix.length, text.length) };
}

function nearestOccurrence(value: string, needle: string, expected: number): number | null {
  let match = value.indexOf(needle);
  if (match < 0) return null;
  let nearest = match;
  let distance = Math.abs(match - expected);
  while (match >= 0) {
    const nextDistance = Math.abs(match - expected);
    if (nextDistance < distance) {
      nearest = match;
      distance = nextDistance;
    }
    match = value.indexOf(needle, match + Math.max(1, needle.length));
  }
  return nearest;
}

function headingBeforeMarkdownOffset(markdown: string, offset: number): string | undefined {
  const prefix = markdown.slice(0, Math.max(0, Math.min(offset, markdown.length)));
  const headings = Array.from(prefix.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gmu));
  const latest = headings.at(-1)?.[1];
  return latest ? normalizeHeading(latest) : undefined;
}

export function semanticPositionFromMarkdown(
  markdown: string,
  position: number,
): EditorSemanticPosition {
  const offset = Math.max(0, Math.min(position, markdown.length));
  const lineStart = markdown.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const nextBreak = markdown.indexOf("\n", offset);
  const lineEnd = nextBreak < 0 ? markdown.length : nextBreak;
  const line = markdown.slice(lineStart, lineEnd);
  const localOffset = offset - lineStart;
  const nearby = nearbyText(line, localOffset);

  return {
    progress: markdown.length === 0 ? 0 : offset / markdown.length,
    headingText: headingBeforeMarkdownOffset(markdown, offset),
    ...nearby,
  };
}

export function markdownPositionFromSemantic(
  markdown: string,
  semantic: EditorSemanticPosition,
): number {
  const expected = Math.round(clampProgress(semantic.progress) * markdown.length);
  if (semantic.text) {
    const match = nearestOccurrence(markdown, semantic.text, expected);
    if (match !== null) {
      return Math.min(markdown.length, match + (semantic.textOffset ?? 0));
    }
  }

  if (semantic.headingText) {
    const headings = Array.from(markdown.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gmu))
      .filter((match) => normalizeHeading(match[1] ?? "") === semantic.headingText)
      .map((match) => match.index ?? 0);
    if (headings.length > 0) {
      return headings.reduce((nearest, position) =>
        Math.abs(position - expected) < Math.abs(nearest - expected) ? position : nearest,
      );
    }
  }

  return expected;
}

export function semanticPositionFromVisualDocument(
  document: ProseMirrorNode,
  position: number,
): EditorSemanticPosition {
  const max = document.content.size;
  const offset = Math.max(0, Math.min(position, max));
  const resolved = document.resolve(offset);
  const parentText = resolved.parent.textContent;
  const nearby = nearbyText(parentText, resolved.parentOffset);
  let headingText: string | undefined;

  document.descendants((node, nodePosition) => {
    if (nodePosition > offset) return false;
    if (node.type.name === "heading") headingText = normalizeHeading(node.textContent);
    return true;
  });

  return {
    progress: max === 0 ? 0 : offset / max,
    headingText,
    ...nearby,
  };
}

export function visualPositionFromSemantic(
  document: ProseMirrorNode,
  semantic: EditorSemanticPosition,
): number {
  const max = document.content.size;
  const expected = Math.round(clampProgress(semantic.progress) * max);
  const textCandidates: number[] = [];
  const headingCandidates: number[] = [];

  document.descendants((node, nodePosition) => {
    if (!node.isTextblock) return true;
    if (semantic.text) {
      const match = node.textContent.indexOf(semantic.text);
      if (match >= 0) {
        textCandidates.push(nodePosition + 1 + match + (semantic.textOffset ?? 0));
      }
    }
    if (
      semantic.headingText &&
      node.type.name === "heading" &&
      normalizeHeading(node.textContent) === semantic.headingText
    ) {
      headingCandidates.push(nodePosition + 1);
    }
    return true;
  });

  const candidates = textCandidates.length > 0 ? textCandidates : headingCandidates;
  if (candidates.length === 0) return expected;
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate - expected) < Math.abs(nearest - expected) ? candidate : nearest,
  );
}
