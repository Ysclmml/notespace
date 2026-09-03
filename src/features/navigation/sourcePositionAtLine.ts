/** Clamp a 1-based disk line / UTF-16 column to the current in-memory text. */
export function sourcePositionAtLine(text: string, line: number, column = 1): number {
  let start = 0;
  for (let index = 1; index < Math.max(1, line); index++) {
    const newline = text.indexOf("\n", start);
    if (newline < 0) return text.length;
    start = newline + 1;
  }
  const newline = text.indexOf("\n", start);
  const end = newline < 0 ? text.length : newline;
  return Math.min(end, start + Math.max(0, column - 1));
}
