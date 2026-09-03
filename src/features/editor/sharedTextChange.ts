export interface SharedTextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** One bounded replacement, leaving the common prefix/suffix and their positions intact. */
export function sharedTextChange(before: string, after: string): SharedTextChange | null {
  if (before === after) return null;
  let from = 0;
  const shortest = Math.min(before.length, after.length);
  while (from < shortest && before[from] === after[from]) from += 1;
  // Do not split a UTF-16 surrogate pair when two emoji share their first unit.
  if (from > 0 && /[\uD800-\uDBFF]/.test(before[from - 1] ?? "")) from -= 1;
  let to = before.length;
  let afterTo = after.length;
  while (to > from && afterTo > from && before[to - 1] === after[afterTo - 1]) {
    to -= 1;
    afterTo -= 1;
  }
  if (/[\uDC00-\uDFFF]/.test(before[to] ?? "")) {
    to += 1;
    afterTo += 1;
  }
  return { from, to, insert: after.slice(from, afterTo) };
}

/** Preserve an in-flight IME draft when an external update was deferred. */
export function mergeCompositionChange(
  base: string,
  draft: string,
  shared: string,
): string {
  const local = sharedTextChange(base, draft);
  const remote = sharedTextChange(base, shared);
  if (!local) return shared;
  if (!remote) return draft;
  if (draft === shared) return shared;
  const simultaneousInsertions =
    local.from === local.to && remote.from === remote.to && local.from === remote.from;
  if (local.to <= remote.from && !simultaneousInsertions) {
    return shared.slice(0, local.from) + local.insert + shared.slice(local.to);
  }
  if (local.from >= remote.to) {
    const shift = remote.insert.length - (remote.to - remote.from);
    return (
      shared.slice(0, local.from + shift) + local.insert + shared.slice(local.to + shift)
    );
  }
  const map = (position: number, association: -1 | 1) => {
    if (position < remote.from || (position === remote.from && association === -1)) {
      return position;
    }
    if (position > remote.to || (position === remote.to && association === 1)) {
      return position + remote.insert.length - (remote.to - remote.from);
    }
    return remote.from + (association === 1 ? remote.insert.length : 0);
  };
  // Disjoint edits both survive. At the same replaced range the active IME
  // draft wins; this is a local editor policy, not a collaborative OT engine.
  const from = map(local.from, local.from === local.to ? 1 : -1);
  const to = Math.max(from, map(local.to, 1));
  return shared.slice(0, from) + local.insert + shared.slice(to);
}
