import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { AppSettingsContext } from "./context";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  type AppLocale,
  type AppSettings,
} from "./model";
import {
  browserSettingsStorage,
  loadAppSettings,
  saveAppSettings,
  type SettingsStorage,
} from "./storage";

export interface AppSettingsProviderProps extends PropsWithChildren {
  readonly initialSettings?: Partial<AppSettings>;
  readonly storage?: SettingsStorage | null;
}

export function AppSettingsProvider({
  children,
  initialSettings,
  storage,
}: AppSettingsProviderProps) {
  const resolvedStorage = useMemo(
    () => (storage === undefined ? browserSettingsStorage() : storage),
    [storage],
  );
  const [settings, setSettings] = useState<AppSettings>(() =>
    normalizeAppSettings({
      ...loadAppSettings(resolvedStorage),
      ...initialSettings,
    }),
  );

  useEffect(() => {
    saveAppSettings(settings, resolvedStorage);
  }, [resolvedStorage, settings]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const root = document.documentElement;
    const previousLocale = root.dataset.locale;
    const previousFontSize = root.style.getPropertyValue("--app-editor-font-size");
    const previousContentWidth = root.style.getPropertyValue("--prose-max");

    root.dataset.locale = settings.locale;
    root.style.setProperty("--app-editor-font-size", `${settings.editorFontSize}px`);
    root.style.setProperty("--prose-max", `${settings.contentWidth}px`);

    return () => {
      if (previousLocale === undefined) delete root.dataset.locale;
      else root.dataset.locale = previousLocale;

      if (previousFontSize) {
        root.style.setProperty("--app-editor-font-size", previousFontSize);
      } else {
        root.style.removeProperty("--app-editor-font-size");
      }
      if (previousContentWidth) {
        root.style.setProperty("--prose-max", previousContentWidth);
      } else {
        root.style.removeProperty("--prose-max");
      }
    };
  }, [settings.contentWidth, settings.editorFontSize, settings.locale]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => normalizeAppSettings({ ...current, ...patch }));
  }, []);

  const setLocale = useCallback((locale: AppLocale) => {
    setSettings((current) => ({ ...current, locale }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_APP_SETTINGS });
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings, setLocale, resetSettings }),
    [resetSettings, setLocale, settings, updateSettings],
  );

  return <AppSettingsContext value={value}>{children}</AppSettingsContext>;
}
