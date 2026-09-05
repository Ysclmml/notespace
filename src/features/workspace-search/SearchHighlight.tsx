import { Fragment } from "react";
import { findHighlightRanges, findRegexHighlightRange } from "./highlightRanges";

export function HighlightMatches({
  text,
  query,
  caseSensitive,
  regexMatchRange,
}: {
  readonly text: string;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly regexMatchRange?: readonly [number, number];
}) {
  const ranges =
    regexMatchRange === undefined
      ? findHighlightRanges(text, query, caseSensitive)
      : findRegexHighlightRange(text, regexMatchRange[0], regexMatchRange[1]);
  return (
    <>
      {ranges.map(([from, to], index) => (
        <Fragment key={from}>
          {text.slice(ranges[index - 1]?.[1] ?? 0, from)}
          <mark>{text.slice(from, to)}</mark>
        </Fragment>
      ))}
      {text.slice(ranges.at(-1)?.[1] ?? 0)}
    </>
  );
}
