import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

interface PositionedMarkdownNode {
  type: string;
  children?: readonly PositionedMarkdownNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

interface SourceRange {
  start: number;
  end: number;
}

interface SourceEdit extends SourceRange {
  replacement: string;
}

const protectionParser = unified().use(remarkParse).use(remarkMath).use(remarkGfm);

// These constructs own their source text. In particular, a formula-looking
// sequence in code or a URL must remain literal instead of becoming math.
const PROTECTED_NODE_TYPES = new Set([
  "code",
  "definition",
  "html",
  "image",
  "imageReference",
  "inlineCode",
  "inlineMath",
  "link",
  "linkReference",
  "math",
]);

function protectedRanges(markdown: string): SourceRange[] {
  const root = protectionParser.parse(markdown) as PositionedMarkdownNode;
  const ranges: SourceRange[] = [];

  function visit(node: PositionedMarkdownNode): void {
    if (PROTECTED_NODE_TYPES.has(node.type)) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined && end > start) {
        ranges.push({ start, end });
      }
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }

  visit(root);
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: SourceRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function isUnescapedToken(markdown: string, offset: number, token: string): boolean {
  return (
    markdown.startsWith(token, offset) && (offset === 0 || markdown[offset - 1] !== "\\")
  );
}

function lineContainsOnlyWhitespaceAroundToken(
  markdown: string,
  offset: number,
  tokenLength: number,
): boolean {
  const lineStart = markdown.lastIndexOf("\n", offset - 1) + 1;
  const newline = markdown.indexOf("\n", offset + tokenLength);
  const lineEnd = newline === -1 ? markdown.length : newline;
  return (
    markdown.slice(lineStart, offset).trim() === "" &&
    markdown.slice(offset + tokenLength, lineEnd).trim() === ""
  );
}

function rangeIndexAtOrAfter(
  ranges: readonly SourceRange[],
  offset: number,
  fromIndex: number,
): number {
  let index = fromIndex;
  while (index < ranges.length && (ranges[index]?.end ?? 0) <= offset) index += 1;
  return index;
}

function findClosingDelimiter(
  markdown: string,
  start: number,
  closingToken: "\\)" | "\\]",
  ranges: readonly SourceRange[],
  firstRangeIndex: number,
  singleLine: boolean,
): number {
  let rangeIndex = rangeIndexAtOrAfter(ranges, start, firstRangeIndex);
  for (let offset = start; offset < markdown.length - 1; offset += 1) {
    rangeIndex = rangeIndexAtOrAfter(ranges, offset, rangeIndex);
    const range = ranges[rangeIndex];
    // Never create a math span across source owned by a code/link/HTML node:
    // after normalization the math tokenizer would otherwise swallow it.
    if (range && range.start <= offset) return -1;
    if (singleLine && markdown[offset] === "\n") return -1;
    if (isUnescapedToken(markdown, offset, closingToken)) return offset;
  }
  return -1;
}

/**
 * Maps the two common TeX/MathJax delimiter pairs to remark-math syntax.
 *
 * Existing dollar math is left byte-for-byte unchanged. The preliminary AST
 * pass protects code, HTML and link/image source ranges, so this is not a
 * document-wide textual replacement. Unclosed pairs also remain untouched.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) return markdown;

  const ranges = protectedRanges(markdown);
  const edits: SourceEdit[] = [];
  let rangeIndex = 0;

  for (let offset = 0; offset < markdown.length - 1; offset += 1) {
    rangeIndex = rangeIndexAtOrAfter(ranges, offset, rangeIndex);
    const protectedRange = ranges[rangeIndex];
    if (protectedRange && protectedRange.start <= offset) {
      offset = protectedRange.end - 1;
      continue;
    }

    const inline = isUnescapedToken(markdown, offset, "\\(");
    const display = !inline && isUnescapedToken(markdown, offset, "\\[");
    if (!inline && !display) continue;

    const closingToken = inline ? "\\)" : "\\]";
    const closingOffset = findClosingDelimiter(
      markdown,
      offset + 2,
      closingToken,
      ranges,
      rangeIndex,
      inline,
    );
    if (closingOffset === -1) continue;

    if (inline) {
      // Two dollars keep offsets stable while remark-math still creates an
      // inline node when both fences are on the same line.
      edits.push({ start: offset, end: offset + 2, replacement: "$$" });
      edits.push({
        start: closingOffset,
        end: closingOffset + 2,
        replacement: "$$",
      });
    } else if (
      lineContainsOnlyWhitespaceAroundToken(markdown, offset, 2) &&
      lineContainsOnlyWhitespaceAroundToken(markdown, closingOffset, 2)
    ) {
      edits.push({ start: offset, end: offset + 2, replacement: "$$" });
      edits.push({
        start: closingOffset,
        end: closingOffset + 2,
        replacement: "$$",
      });
    } else {
      const formula = markdown.slice(offset + 2, closingOffset);
      edits.push({
        start: offset,
        end: closingOffset + 2,
        replacement: `\n$$\n${formula}\n$$\n`,
      });
    }

    offset = closingOffset + 1;
  }

  if (edits.length === 0) return markdown;
  let normalized = markdown;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    normalized = `${normalized.slice(0, edit.start)}${edit.replacement}${normalized.slice(edit.end)}`;
  }
  return normalized;
}
