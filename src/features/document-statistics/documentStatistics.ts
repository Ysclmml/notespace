/** A rebuildable projection of the current source text, never editor state. */
export interface DocumentStatistics {
  wordCount: number;
  /** Unicode code points, including whitespace and Markdown source syntax. */
  characterCount: number;
  characterCountWithoutSpaces: number;
  /** Physical source lines; CRLF is one line break and an empty document has none. */
  lineCount: number;
}

export const EMPTY_DOCUMENT_STATISTICS: Readonly<DocumentStatistics> = Object.freeze({
  wordCount: 0,
  characterCount: 0,
  characterCountWithoutSpaces: 0,
  lineCount: 0,
});

export const STATISTICS_CHUNK_SIZE = 32 * 1024;

const cjkCharacter =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const letterOrNumber = /[\p{L}\p{N}]/u;
const combiningMark = /\p{M}/u;
const whitespace = /\s/u;

/**
 * Count source text uniformly for Markdown and code: syntax and URLs are not
 * parsed away. CJK code points count individually; other adjacent letters and
 * numbers form words. Punctuation/emoji do not form words. Combining marks
 * continue an existing word, while character totals still count code points.
 *
 * Advancing in bounded slices lets the UI yield between chunks without changing
 * the counting rules for large documents or splitting a word/surrogate/CRLF.
 */
export function createDocumentStatisticsTask(text: string) {
  const statistics: DocumentStatistics = {
    ...EMPTY_DOCUMENT_STATISTICS,
    lineCount: text.length ? 1 : 0,
  };
  let offset = 0;
  let insideWord = false;
  let previousWasCarriageReturn = false;

  return {
    advance(maxCodeUnits = STATISTICS_CHUNK_SIZE): DocumentStatistics | undefined {
      const limit = Math.min(text.length, offset + Math.max(1, maxCodeUnits));
      while (offset < limit) {
        const codePoint = text.codePointAt(offset)!;
        const character = String.fromCodePoint(codePoint);
        offset += codePoint > 0xffff ? 2 : 1;
        statistics.characterCount += 1;

        if (!whitespace.test(character)) statistics.characterCountWithoutSpaces += 1;
        if (codePoint === 13 || (codePoint === 10 && !previousWasCarriageReturn)) {
          statistics.lineCount += 1;
        }
        previousWasCarriageReturn = codePoint === 13;

        // Most source text is ASCII, so avoid Unicode category checks for it.
        if (codePoint < 128) {
          const isWordCharacter =
            (codePoint >= 48 && codePoint <= 57) ||
            (codePoint >= 65 && codePoint <= 90) ||
            (codePoint >= 97 && codePoint <= 122);
          if (isWordCharacter && !insideWord) statistics.wordCount += 1;
          insideWord = isWordCharacter;
        } else if (cjkCharacter.test(character)) {
          statistics.wordCount += 1;
          insideWord = false;
        } else if (letterOrNumber.test(character)) {
          if (!insideWord) statistics.wordCount += 1;
          insideWord = true;
        } else if (!combiningMark.test(character)) {
          insideWord = false;
        }
      }
      return offset === text.length ? statistics : undefined;
    },
  };
}

/** Synchronous pure entry point for tests and other non-interactive consumers. */
export function calculateDocumentStatistics(text: string): DocumentStatistics {
  const task = createDocumentStatisticsTask(text);
  let statistics: DocumentStatistics | undefined;
  do {
    statistics = task.advance();
  } while (!statistics);
  return statistics;
}
