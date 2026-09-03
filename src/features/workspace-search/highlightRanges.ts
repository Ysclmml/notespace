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
 * Regex matching remains native. The browser only locates the first visible match
 * in the returned snippet; its end always comes from the native UTF-16 length.
 */
export function findRegexHighlightRange(
  text: string,
  query: string,
  caseSensitive: boolean,
  matchLength: number,
  matchColumn?: number,
): ReadonlyArray<readonly [number, number]> {
  if (!query || !Number.isSafeInteger(matchLength) || matchLength <= 0) return [];
  const columnStart = (matchColumn ?? 0) - 1;
  if (
    !text.startsWith("…") &&
    typeof matchColumn === "number" &&
    Number.isSafeInteger(matchColumn) &&
    columnStart >= 0 &&
    columnStart + matchLength <= text.length
  ) {
    return [[columnStart, columnStart + matchLength]];
  }
  try {
    const match = new RegExp(query, caseSensitive ? "u" : "iu").exec(text);
    if (!match || match.index < 0) return [];
    const end = match.index + matchLength;
    if (end > text.length) return [];
    return [[match.index, end]];
  } catch {
    // The native regex dialect is authoritative and can accept syntax that the
    // browser does not understand. In that uncommon case, render plain text.
    return [];
  }
}
