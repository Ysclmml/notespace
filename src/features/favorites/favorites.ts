import type { StorageLike } from "../workspace/workspaceHistory";

export const FAVORITES_STORAGE_KEY = "markdown-workspace.favorites.v1";
export const MAX_FAVORITES = 100;

function pathKey(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return /^[a-z]:\//iu.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function normalizeFavorites(value: unknown, allowDemo = false): readonly string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((path): path is string => {
    if (
      typeof path !== "string" ||
      path.length > 4096 ||
      !(
        /^(?:\/|[a-z]:[\\/]|\\\\)/iu.test(path) ||
        (allowDemo && path.startsWith("demo://paper-and-ink/"))
      ) ||
      Array.from(path).some((char) => char.charCodeAt(0) < 32) ||
      seen.has(pathKey(path)) ||
      seen.size >= MAX_FAVORITES
    )
      return false;
    seen.add(pathKey(path));
    return true;
  });
}

function currentStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadFavorites(
  storage: StorageLike | null = currentStorage(),
): readonly string[] {
  try {
    return normalizeFavorites(JSON.parse(storage?.getItem(FAVORITES_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveFavorites(
  paths: readonly string[],
  storage: StorageLike | null = currentStorage(),
): void {
  try {
    storage?.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(normalizeFavorites(paths)));
  } catch {
    /* Convenience metadata must not interrupt editing. */
  }
}

export function isFavorite(paths: readonly string[], path: string): boolean {
  return paths.some((item) => pathKey(item) === pathKey(path));
}

export function toggleFavorite(
  paths: readonly string[],
  path: string,
  allowDemo = false,
): readonly string[] {
  return isFavorite(paths, path)
    ? paths.filter((item) => pathKey(item) !== pathKey(path))
    : normalizeFavorites([...paths, path], allowDemo);
}

export function relocateFavorite(
  paths: readonly string[],
  previous: string,
  next: string,
): readonly string[] {
  return normalizeFavorites(
    paths.map((path) => (pathKey(path) === pathKey(previous) ? next : path)),
  );
}

export const favoriteLabels = {
  "zh-CN": {
    title: "收藏",
    add: "收藏当前文件",
    addFile: "添加到收藏",
    remove: "取消收藏",
    empty: "还没有收藏的文件",
    hint: "右键文件或点击工具栏星标添加。",
    unsaved: "保存文件后即可收藏",
    limit: "收藏最多保留 100 个文件",
    open: "打开收藏",
    expand: "展开收藏",
    collapse: "折叠收藏",
    retry: "重试打开",
    missing: "文件不存在",
    unreadable: "无法读取",
    unavailable: "暂不可用",
  },
  "en-US": {
    title: "Favorites",
    add: "Favorite current file",
    addFile: "Add to favorites",
    remove: "Remove favorite",
    empty: "No favorite files yet",
    hint: "Right-click a file or use the toolbar star to add one.",
    unsaved: "Save this file to add a favorite",
    limit: "Favorites can hold up to 100 files",
    open: "Open favorite",
    expand: "Expand favorites",
    collapse: "Collapse favorites",
    retry: "Retry opening",
    missing: "File missing",
    unreadable: "Cannot read",
    unavailable: "Unavailable",
  },
} as const;
