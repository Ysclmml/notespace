export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export const AUTO_SAVE_MODES = ["manual", "afterDelay"] as const;
export const STARTUP_BEHAVIORS = ["restore", "empty"] as const;
export const AUTO_SAVE_DELAY_MIN_SECONDS = 1;
export const AUTO_SAVE_DELAY_MAX_SECONDS = 300;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type AutoSaveMode = (typeof AUTO_SAVE_MODES)[number];
export type StartupBehavior = (typeof STARTUP_BEHAVIORS)[number];

export interface AppSettings {
  readonly locale: AppLocale;
  readonly editorFontSize: number;
  readonly contentWidth: number;
  readonly showCodeLineNumbers: boolean;
  readonly showTypingHints: boolean;
  readonly codeWrap: boolean;
  readonly autoSaveMode: AutoSaveMode;
  readonly autoSaveDelaySeconds: number;
  readonly startupBehavior: StartupBehavior;
}

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  locale: "zh-CN",
  editorFontSize: 16,
  contentWidth: 920,
  showCodeLineNumbers: true,
  showTypingHints: true,
  codeWrap: true,
  autoSaveMode: "manual",
  autoSaveDelaySeconds: 5,
  startupBehavior: "restore",
});

function clampNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en-US";
}

export function isAutoSaveMode(value: unknown): value is AutoSaveMode {
  return value === "manual" || value === "afterDelay";
}

export function isStartupBehavior(value: unknown): value is StartupBehavior {
  return value === "restore" || value === "empty";
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<keyof AppSettings, unknown>>)
      : {};

  return {
    locale: isAppLocale(candidate.locale) ? candidate.locale : DEFAULT_APP_SETTINGS.locale,
    editorFontSize: clampNumber(
      candidate.editorFontSize,
      DEFAULT_APP_SETTINGS.editorFontSize,
      12,
      28,
    ),
    contentWidth: clampNumber(
      candidate.contentWidth,
      DEFAULT_APP_SETTINGS.contentWidth,
      640,
      1600,
    ),
    showCodeLineNumbers: booleanOr(
      candidate.showCodeLineNumbers,
      DEFAULT_APP_SETTINGS.showCodeLineNumbers,
    ),
    showTypingHints: booleanOr(
      candidate.showTypingHints,
      DEFAULT_APP_SETTINGS.showTypingHints,
    ),
    codeWrap: booleanOr(candidate.codeWrap, DEFAULT_APP_SETTINGS.codeWrap),
    autoSaveMode: isAutoSaveMode(candidate.autoSaveMode)
      ? candidate.autoSaveMode
      : DEFAULT_APP_SETTINGS.autoSaveMode,
    autoSaveDelaySeconds: clampNumber(
      candidate.autoSaveDelaySeconds,
      DEFAULT_APP_SETTINGS.autoSaveDelaySeconds,
      AUTO_SAVE_DELAY_MIN_SECONDS,
      AUTO_SAVE_DELAY_MAX_SECONDS,
    ),
    startupBehavior: isStartupBehavior(candidate.startupBehavior)
      ? candidate.startupBehavior
      : DEFAULT_APP_SETTINGS.startupBehavior,
  };
}
