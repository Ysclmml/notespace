import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import { markdownLanguage } from "@codemirror/lang-markdown";

export interface EditorSemanticPosition {
  /** Stable fallback when the surrounding text cannot be matched exactly. */
  readonly progress: number;
  /** Nearest section heading, when one exists. */
  readonly headingText?: string;
  /** A short plain-text needle around the visible selection or viewport. */
  readonly text?: string;
  /** Caret offset within `text`. */
  readonly textOffset?: number;
  /** Parsed single-line alternative when the source needle includes markup. */
  readonly plainText?: string;
  readonly plainTextOffset?: number;
}

interface TextProjection {
  readonly text: string;
  /** Original UTF-16 positions for each normalized text character. */
  readonly offsets: readonly number[];
}

const MAX_PROJECTED_LINE_LENGTH = 8192;
const markdownLineProjections = new Map<string, TextProjection>();
const MARKUP_NODES = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "HeaderMark",
  "ListMark",
  "QuoteMark",
  "TaskMarker",
]);

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

function projectText(value: string, hidden?: Uint8Array): TextProjection {
  const characters: string[] = [];
  const offsets: number[] = [];
  let whitespace = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (hidden?.[index]) continue;
    const character = value[index]!;
    if (/\s/u.test(character)) {
      if (characters.length > 0 && whitespace < 0) whitespace = index;
      continue;
    }
    if (whitespace >= 0) {
      characters.push(" ");
      offsets.push(whitespace);
      whitespace = -1;
    }
    characters.push(character);
    offsets.push(index);
  }
  return { text: characters.join(""), offsets };
}

function projectMarkdownLine(value: string): TextProjection {
  // A physical line is enough for ordinary inline formatting. Do not parse a
  // whole document on scroll, or guess context-dependent tables/fenced code.
  if (value.length > MAX_PROJECTED_LINE_LENGTH) return projectText(value);
  const cached = markdownLineProjections.get(value);
  if (cached) {
    markdownLineProjections.delete(value);
    markdownLineProjections.set(value, cached);
    return cached;
  }
  const hidden = new Uint8Array(value.length);
  markdownLanguage.parser.parse(value).iterate({
    enter(node) {
      if (node.name === "Image") return false;
      if (node.name === "Link") {
        // Reference/shortcut links require the surrounding document to resolve.
        // Keep them literal rather than stripping brackets from ordinary text.
        if (!node.node.getChild("URL")) return false;
        const marks = node.node.getChildren("LinkMark");
        const opening = marks[0];
        const closing = marks.find((mark) => value.slice(mark.from, mark.to) === "]");
        if (opening && closing) {
          hidden.fill(1, opening.from, opening.to);
          hidden.fill(1, closing.from, node.to);
        }
      } else if (
        MARKUP_NODES.has(node.name) ||
        (node.name === "LinkMark" && node.node.parent?.name === "Autolink")
      ) {
        hidden.fill(1, node.from, node.to);
      } else if (node.name === "Escape") {
        hidden[node.from] = 1;
      }
      return true;
    },
  });
  const projection = projectText(value, hidden);
  markdownLineProjections.set(value, projection);
  if (markdownLineProjections.size > 4) {
    markdownLineProjections.delete(markdownLineProjections.keys().next().value!);
  }
  return projection;
}

function projectionOffset(projection: TextProjection, rawOffset: number): number {
  const match = projection.offsets.findIndex((offset) => offset >= rawOffset);
  return match < 0 ? projection.text.length : match;
}

function rawOffset(projection: TextProjection, offset: number): number {
  const index = Math.max(0, Math.min(offset, projection.text.length));
  return projection.offsets[index] ?? (projection.offsets.at(-1) ?? -1) + 1;
}

function nearbyProjectedText(
  projection: TextProjection,
  rawPosition: number,
): { text?: string; textOffset?: number } {
  const normalizedOffset = projectionOffset(projection, rawPosition);
  const value = projection.text;
  const radius = 32;
  let start = Math.max(0, normalizedOffset - radius);
  let end = Math.min(value.length, normalizedOffset + radius);

  while (start < normalizedOffset && /\s/u.test(value[start] ?? "")) start += 1;
  while (end > normalizedOffset && /\s/u.test(value[end - 1] ?? "")) end -= 1;
  const text = value.slice(start, end);
  if (!text) return {};
  return { text, textOffset: normalizedOffset - start };
}

function nearbyRawText(value: string, position: number) {
  // Capturing a caret/scroll position is frequent, including in sourceOnly
  // documents. Keep normalization/offset arrays bounded even for a huge line.
  const offset = Math.max(0, Math.min(position, value.length));
  const start = Math.max(0, offset - 128);
  const end = Math.min(value.length, offset + 128);
  return nearbyProjectedText(projectText(value.slice(start, end)), offset - start);
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
    match = value.indexOf(needle, match + 1);
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
  const nearby = nearbyRawText(line, localOffset);
  const plain =
    line.length <= MAX_PROJECTED_LINE_LENGTH
      ? nearbyProjectedText(projectMarkdownLine(line), localOffset)
      : {};

  return {
    progress: markdown.length === 0 ? 0 : offset / markdown.length,
    headingText: headingBeforeMarkdownOffset(markdown, offset),
    ...nearby,
    ...(plain.text && plain.text !== nearby.text
      ? { plainText: plain.text, plainTextOffset: plain.textOffset }
      : {}),
  };
}

export function markdownPositionFromSemantic(
  markdown: string,
  semantic: EditorSemanticPosition,
): number {
  const expected = Math.round(clampProgress(semantic.progress) * markdown.length);
  if (semantic.text) {
    const match = nearestOccurrence(
      markdown,
      semantic.text,
      expected - (semantic.textOffset ?? 0),
    );
    if (match !== null) {
      return Math.min(markdown.length, match + (semantic.textOffset ?? 0));
    }
  }

  // This path runs only when resolving a mode switch. The report/capture path
  // above projects one bounded line, not every line of the document.
  for (const [text, textOffset] of [
    [semantic.text, semantic.textOffset],
    [semantic.plainText, semantic.plainTextOffset],
  ] as const) {
    if (!text) continue;
    let nearest: number | undefined;
    let lineStart = 0;
    while (lineStart <= markdown.length) {
      const nextBreak = markdown.indexOf("\n", lineStart);
      const lineEnd = nextBreak < 0 ? markdown.length : nextBreak;
      const projection = projectMarkdownLine(markdown.slice(lineStart, lineEnd));
      const expectedOffset = projectionOffset(projection, expected - lineStart);
      const match = nearestOccurrence(
        projection.text,
        text,
        expectedOffset - (textOffset ?? 0),
      );
      if (match !== null) {
        const position = lineStart + rawOffset(projection, match + (textOffset ?? 0));
        if (
          nearest === undefined ||
          Math.abs(position - expected) < Math.abs(nearest - expected)
        ) {
          nearest = position;
        }
      }
      if (nextBreak < 0) break;
      lineStart = nextBreak + 1;
    }
    if (nearest !== undefined) return nearest;
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
  const nearby = nearbyRawText(parentText, resolved.parentOffset);
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
  const textCandidates: number[][] = [[], []];
  const headingCandidates: number[] = [];

  document.descendants((node, nodePosition) => {
    if (!node.isTextblock) return true;
    const projection = projectText(node.textContent);
    const expectedOffset = projectionOffset(projection, expected - nodePosition - 1);
    const needles = [
      [semantic.text, semantic.textOffset],
      [semantic.plainText, semantic.plainTextOffset],
    ] as const;
    needles.forEach(([text, textOffset], index) => {
      if (!text) return;
      const match = nearestOccurrence(
        projection.text,
        text,
        expectedOffset - (textOffset ?? 0),
      );
      if (match !== null) {
        textCandidates[index]!.push(
          nodePosition + 1 + rawOffset(projection, match + (textOffset ?? 0)),
        );
      }
    });
    if (
      semantic.headingText &&
      node.type.name === "heading" &&
      normalizeHeading(node.textContent) === semantic.headingText
    ) {
      headingCandidates.push(nodePosition + 1);
    }
    return true;
  });

  const candidates =
    textCandidates.find((positions) => positions.length > 0) ?? headingCandidates;
  if (candidates.length === 0) return expected;
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate - expected) < Math.abs(nearest - expected) ? candidate : nearest,
  );
}
