import { use } from "react";

import { AppSettingsContext, type AppSettingsContextValue } from "./context";

export function useAppSettings(): AppSettingsContextValue {
  const value = use(AppSettingsContext);
  if (!value) {
    throw new Error("useAppSettings must be used inside AppSettingsProvider");
  }
  return value;
}
