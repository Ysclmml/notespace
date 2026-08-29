export interface OutlineItem {
  readonly from: number;
  readonly level: number;
  readonly title: string;
  readonly line: number;
}

export function extractOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let fence: string | null = null;
  let from = 0;

  for (const [index, line] of markdown.split("\n").entries()) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (!fence) fence = marker[0] ?? null;
      else if (marker[0] === fence) fence = null;
      from += line.length + 1;
      continue;
    }
    if (fence) {
      from += line.length + 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      items.push({
        from,
        level: heading[1]?.length ?? 1,
        title: heading[2] ?? "",
        line: index + 1,
      });
    }
    from += line.length + 1;
  }

  return items;
}
