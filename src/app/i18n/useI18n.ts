import { useCallback } from "react";

import { useAppSettings } from "../settings";
import { translate, type TranslationKey, type TranslationValues } from "./translations";

export function useI18n() {
  const {
    settings: { locale },
  } = useAppSettings();
  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values),
    [locale],
  );

  return { locale, t } as const;
}
