interface FoldedText {
  readonly value: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

/** Rust search folds each Unicode scalar separately, not locale/context-sensitive text. */
function foldText(text: string): FoldedText {
  let value = "";
  let offset = 0;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const character of text) {
    const folded = character.toLowerCase();
    for (let index = 0; index < folded.length; index += 1) {
      starts.push(offset);
      ends.push(offset + character.length);
    }
    value += folded;
    offset += character.length;
  }
  return { value, starts, ends };
}

export function findHighlightRanges(
  text: string,
  query: string,
  caseSensitive: boolean,
): ReadonlyArray<readonly [number, number]> {
  if (!query) return [];
  const folded = caseSensitive ? null : foldText(text);
  const haystack = folded?.value ?? text;
  const needle = caseSensitive ? query : foldText(query).value;
  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found < 0) break;
    const from = folded ? folded.starts[found] : found;
    const to = folded ? folded.ends[found + needle.length - 1] : found + needle.length;
    if (from !== undefined && to !== undefined) {
      const previous = ranges.at(-1);
      if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
      else ranges.push([from, to]);
    }
    cursor = found + needle.length;
  }
  return ranges;
}

/**
 * Regex matching remains native. Only validate and draw its visible UTF-16 range;
 * JavaScript's backtracking regex engine must not execute user queries here.
 */
export function findRegexHighlightRange(
  text: string,
  start: number,
  end: number,
): ReadonlyArray<readonly [number, number]> {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length
  ) {
    return [];
  }
  return [[start, end]];
}
