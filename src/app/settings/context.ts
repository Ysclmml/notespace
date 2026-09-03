import { createContext } from "react";

import type { AppLocale, AppSettings } from "./model";

export interface AppSettingsContextValue {
  readonly settings: AppSettings;
  readonly updateSettings: (patch: Partial<AppSettings>) => void;
  readonly setLocale: (locale: AppLocale) => void;
  readonly resetSettings: () => void;
}

export const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);
