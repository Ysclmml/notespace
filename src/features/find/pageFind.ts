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
}
