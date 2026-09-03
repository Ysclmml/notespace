import { use } from "react";

import { AppSettingsContext } from "../../app/settings/context";
import { DEFAULT_SHORTCUTS } from "../shortcuts/shortcuts";

/** Standalone editor consumers keep the same defaults as the application. */
export function useFormattingShortcuts() {
  return use(AppSettingsContext)?.settings.shortcuts ?? DEFAULT_SHORTCUTS;
}

export function formattingIsBlocked(event: KeyboardEvent): boolean {
  return Boolean(
    event.isComposing ||
    event.keyCode === 229 ||
    document.querySelector('[role="dialog"][aria-modal="true"], .visual-viewer'),
  );
}
