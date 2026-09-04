export const DEFAULT_MOBILE_ACCESS_PORT = 49_920;
export const MIN_MOBILE_ACCESS_PORT = 1_024;
export const MAX_MOBILE_ACCESS_PORT = 65_535;
export const MOBILE_ACCESS_PORT_STORAGE_KEY = "markdown-workspace.mobile-access.v1";

interface MobileAccessPreferences {
  readonly port?: number;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function parseMobileAccessPort(value: unknown): number | null {
  const port =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isInteger(port) &&
    port >= MIN_MOBILE_ACCESS_PORT &&
    port <= MAX_MOBILE_ACCESS_PORT
    ? port
    : null;
}

export function loadMobileAccessPort(storage = browserStorage()): number {
  if (!storage) return DEFAULT_MOBILE_ACCESS_PORT;
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(MOBILE_ACCESS_PORT_STORAGE_KEY) ?? "",
    );
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_MOBILE_ACCESS_PORT;
    }
    return (
      parseMobileAccessPort((parsed as MobileAccessPreferences).port) ??
      DEFAULT_MOBILE_ACCESS_PORT
    );
  } catch {
    return DEFAULT_MOBILE_ACCESS_PORT;
  }
}

export function saveMobileAccessPort(value: unknown, storage = browserStorage()): boolean {
  const port = parseMobileAccessPort(value);
  if (!storage || port === null) return false;
  try {
    storage.setItem(
      MOBILE_ACCESS_PORT_STORAGE_KEY,
      JSON.stringify({ port } satisfies MobileAccessPreferences),
    );
    return true;
  } catch {
    return false;
  }
}
