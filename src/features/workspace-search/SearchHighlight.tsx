import { Fragment } from "react";
import { findHighlightRanges, findRegexHighlightRange } from "./highlightRanges";

export function HighlightMatches({
  text,
  query,
  caseSensitive,
  regexMatchLength,
  regexMatchColumn,
}: {
  readonly text: string;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly regexMatchLength?: number;
  readonly regexMatchColumn?: number;
}) {
  const ranges =
    regexMatchLength === undefined
      ? findHighlightRanges(text, query, caseSensitive)
      : findRegexHighlightRange(
          text,
          query,
          caseSensitive,
          regexMatchLength,
          regexMatchColumn,
        );
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
