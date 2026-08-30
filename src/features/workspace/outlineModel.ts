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

export function markdownHeadingSlug(title: string): string {
  return title
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

export function findMarkdownAnchorPosition(
  markdown: string,
  anchor: string | undefined,
): number | null {
  if (!anchor) return null;
  let decoded = anchor.replace(/^#/u, "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the literal fragment when it is not valid percent encoding.
  }
  const wanted = markdownHeadingSlug(decoded);
  const matches = new Map<string, number>();
  for (const item of extractOutline(markdown)) {
    const base = markdownHeadingSlug(item.title);
    const duplicate = matches.get(base) ?? 0;
    matches.set(base, duplicate + 1);
    const slug = duplicate === 0 ? base : `${base}-${duplicate}`;
    if (slug === wanted || item.title === decoded) return item.from;
  }
  return null;
}
