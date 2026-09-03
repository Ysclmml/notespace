export interface FindMatch {
  readonly from: number;
  readonly to: number;
}

/** Literal, case-insensitive matching with UTF-16 positions usable by both editors. */
export function findTextMatches(text: string, query: string): FindMatch[] {
  if (!query) return [];
  // RegExp's case folding retains source offsets (lowercasing can change length).
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp(pattern, "giu");
  return Array.from(text.matchAll(expression), (match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }));
}

export interface PageFindTarget {
  matches: (query: string) => readonly FindMatch[];
  highlight: (matches: readonly FindMatch[], current: number, reveal: boolean) => void;
  focus: () => void;
  replace?: (matches: readonly FindMatch[], replacement: string) => ReplaceResult;
}

export type ReplaceResult = "replaced" | "blocked" | "composing" | "readonly";

export const MAX_REPLACE_MATCHES = 10_000;

/** Bound expansion before allocating repeated replacement text. */
export function replacementIsSafe(
  text: string,
  matches: readonly FindMatch[],
  replacement: string,
): boolean {
  if (matches.length > MAX_REPLACE_MATCHES) return false;
  const nextLength = matches.reduce(
    (length, match) => length + replacement.length - (match.to - match.from),
    text.length,
  );
  if (nextLength > Math.max(text.length, 16 * 1024 * 1024)) return false;
  if (isOversizedInlineImagePaste(replacement)) return false;
  const fragments: string[] = [];
  let start = 0;
  for (const match of matches) {
    fragments.push(text.slice(start, match.from), replacement);
    start = match.to;
  }
  fragments.push(text.slice(start));
  return !isOversizedInlineImagePaste(fragments.join(""));
}
import { isOversizedInlineImagePaste } from "../editor/pasteGuard";
