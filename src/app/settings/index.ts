export { AppSettingsProvider, type AppSettingsProviderProps } from "./AppSettingsProvider";
export { useAppSettings } from "./useAppSettings";
export {
  AUTO_SAVE_DELAY_MAX_SECONDS,
  AUTO_SAVE_DELAY_MIN_SECONDS,
  AUTO_SAVE_MODES,
  DEFAULT_SEARCH_HISTORY_LIMIT,
  DEFAULT_APP_SETTINGS,
  SEARCH_HISTORY_LIMIT_MAX,
  SEARCH_HISTORY_LIMIT_MIN,
  SUPPORTED_LOCALES,
  STARTUP_BEHAVIORS,
  isAppLocale,
  isAutoSaveMode,
  isStartupBehavior,
  normalizeAppSettings,
  type AppLocale,
  type AppSettings,
  type AutoSaveMode,
  type StartupBehavior,
} from "./model";
export {
  APP_SETTINGS_STORAGE_KEY,
  browserSettingsStorage,
  loadAppSettings,
  saveAppSettings,
  type SettingsStorage,
} from "./storage";
