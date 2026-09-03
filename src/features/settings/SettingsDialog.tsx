import { useEffect, useId, useRef, useState } from "react";

import { useI18n } from "../../app/i18n";
import {
  AUTO_SAVE_DELAY_MAX_SECONDS,
  AUTO_SAVE_DELAY_MIN_SECONDS,
  SEARCH_HISTORY_LIMIT_MAX,
  SEARCH_HISTORY_LIMIT_MIN,
  useAppSettings,
  type AppLocale,
  type AutoSaveMode,
  type StartupBehavior,
} from "../../app/settings";
import { shortcutLabels } from "../shortcuts/labels";
import { ShortcutSettings } from "./ShortcutSettings";
import "./SettingsDialog.css";

type SettingsSection = "general" | "editor" | "appearance" | "shortcuts";

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

function SwitchRow({
  checked,
  description,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly description: string;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-switch-row">
      <span className="settings-field__copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="settings-switch">
        <input
          aria-label={label}
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span aria-hidden="true" className="settings-switch__track" />
      </span>
    </label>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useI18n();
  const { settings, updateSettings, setLocale, resetSettings } = useAppSettings();
  const [section, setSection] = useState<SettingsSection>("general");
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const sections: ReadonlyArray<{
    id: SettingsSection;
    label: string;
    symbol: string;
  }> = [
    { id: "general", label: t("settings.general"), symbol: "•••" },
    { id: "editor", label: t("settings.editor"), symbol: "Aa" },
    { id: "appearance", label: t("settings.appearance"), symbol: "◐" },
    { id: "shortcuts", label: shortcutLabels[settings.locale].title, symbol: "⌘" },
  ];

  return (
    <div
      className="settings-dialog-layer"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="settings-dialog"
        onKeyDown={(event) => {
          if (
            event.key !== "Tab" ||
            event.defaultPrevented ||
            event.nativeEvent.isComposing
          )
            return;
          const dialog = dialogRef.current;
          if (!dialog) return;
          const fields = [
            ...dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            ),
          ].filter((field) => !field.closest('[hidden], [inert], [aria-hidden="true"]'));
          const first = fields[0];
          const last = fields.at(-1);
          if (!first || !last) return;
          const active = document.activeElement;
          if (
            !dialog.contains(active) ||
            (event.shiftKey ? active === first : active === last)
          ) {
            event.preventDefault();
            event.stopPropagation();
            (event.shiftKey ? last : first).focus();
          }
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header className="settings-dialog__titlebar">
          <h2 id={titleId}>{t("settings.title")}</h2>
          <button
            aria-label={t("common.close")}
            className="settings-dialog__close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="settings-dialog__body">
          <nav aria-label={t("settings.title")} className="settings-sidebar" role="tablist">
            {sections.map((item) => (
              <button
                aria-controls={panelId}
                aria-selected={section === item.id}
                className="settings-sidebar__item"
                key={item.id}
                onClick={() => setSection(item.id)}
                role="tab"
                type="button"
              >
                <span aria-hidden="true" className="settings-sidebar__symbol">
                  {item.symbol}
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          <div
            aria-label={sections.find((item) => item.id === section)?.label}
            className="settings-panel"
            id={panelId}
            role="tabpanel"
          >
            <h3>{sections.find((item) => item.id === section)?.label}</h3>

            {section === "shortcuts" ? <ShortcutSettings /> : null}

            {section === "general" ? (
              <div className="settings-group">
                <label className="settings-field">
                  <span className="settings-field__copy">
                    <strong>{t("settings.language")}</strong>
                    <small>{t("settings.languageDescription")}</small>
                  </span>
                  <select
                    aria-label={t("settings.language")}
                    onChange={(event) => setLocale(event.currentTarget.value as AppLocale)}
                    value={settings.locale}
                  >
                    <option value="zh-CN">{t("settings.languageChinese")}</option>
                    <option value="en-US">{t("settings.languageEnglish")}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span className="settings-field__copy">
                    <strong>{t("settings.startupBehavior")}</strong>
                    <small>{t("settings.startupBehaviorDescription")}</small>
                  </span>
                  <select
                    aria-label={t("settings.startupBehavior")}
                    onChange={(event) =>
                      updateSettings({
                        startupBehavior: event.currentTarget.value as StartupBehavior,
                      })
                    }
                    value={settings.startupBehavior}
                  >
                    <option value="restore">{t("settings.startupRestore")}</option>
                    <option value="empty">{t("settings.startupEmpty")}</option>
                  </select>
                </label>
                <SwitchRow
                  checked={settings.showFavorites}
                  description={t("settings.showFavoritesDescription")}
                  label={t("settings.showFavorites")}
                  onChange={(showFavorites) => updateSettings({ showFavorites })}
                />
                <label className="settings-field">
                  <span className="settings-field__copy">
                    <strong>{t("settings.searchHistoryLimit")}</strong>
                    <small>{t("settings.searchHistoryLimitDescription")}</small>
                  </span>
                  <span className="settings-number">
                    <input
                      aria-label={t("settings.searchHistoryLimit")}
                      max={SEARCH_HISTORY_LIMIT_MAX}
                      min={SEARCH_HISTORY_LIMIT_MIN}
                      onChange={(event) =>
                        updateSettings({
                          searchHistoryLimit: Number(event.currentTarget.value),
                        })
                      }
                      step="1"
                      type="number"
                      value={settings.searchHistoryLimit}
                    />
                    <span>{t("settings.searchHistoryItems")}</span>
                  </span>
                </label>
                <SwitchRow
                  checked={settings.checkUpdatesOnStartup}
                  description={t("settings.checkUpdatesOnStartupDescription")}
                  label={t("settings.checkUpdatesOnStartup")}
                  onChange={(checkUpdatesOnStartup) =>
                    updateSettings({ checkUpdatesOnStartup })
                  }
                />
                <label className="settings-field">
                  <span className="settings-field__copy">
                    <strong>{t("settings.autoSaveMode")}</strong>
                    <small>{t("settings.autoSaveModeDescription")}</small>
                  </span>
                  <select
                    aria-label={t("settings.autoSaveMode")}
                    onChange={(event) =>
                      updateSettings({
                        autoSaveMode: event.currentTarget.value as AutoSaveMode,
                      })
                    }
                    value={settings.autoSaveMode}
                  >
                    <option value="manual">{t("settings.autoSaveManual")}</option>
                    <option value="afterDelay">{t("settings.autoSaveAfterDelay")}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span className="settings-field__copy">
                    <strong>{t("settings.autoSaveDelay")}</strong>
                    <small>{t("settings.autoSaveDelayDescription")}</small>
                  </span>
                  <span className="settings-number">
                    <input
                      aria-label={t("settings.autoSaveDelay")}
                      disabled={settings.autoSaveMode !== "afterDelay"}
                      max={AUTO_SAVE_DELAY_MAX_SECONDS}
                      min={AUTO_SAVE_DELAY_MIN_SECONDS}
                      onChange={(event) =>
                        updateSettings({
                          autoSaveDelaySeconds: Number(event.currentTarget.value),
                        })
                      }
                      step="1"
                      type="number"
                      value={settings.autoSaveDelaySeconds}
                    />
                    <span>{t("settings.seconds")}</span>
                  </span>
                </label>
              </div>
            ) : null}

            {section === "editor" ? (
              <div className="settings-group">
                <label className="settings-field settings-field--slider">
                  <span className="settings-field__copy">
                    <strong>{t("settings.fontSize")}</strong>
                    <small>{t("settings.fontSizeDescription")}</small>
                  </span>
                  <span className="settings-slider">
                    <input
                      aria-label={t("settings.fontSize")}
                      max="28"
                      min="12"
                      onChange={(event) =>
                        updateSettings({
                          editorFontSize: Number(event.currentTarget.value),
                        })
                      }
                      step="1"
                      type="range"
                      value={settings.editorFontSize}
                    />
                    <output>
                      {t("settings.pixels", { value: settings.editorFontSize })}
                    </output>
                  </span>
                </label>
                <SwitchRow
                  checked={settings.showCodeLineNumbers}
                  description={t("settings.lineNumbersDescription")}
                  label={t("settings.lineNumbers")}
                  onChange={(showCodeLineNumbers) =>
                    updateSettings({ showCodeLineNumbers })
                  }
                />
                <SwitchRow
                  checked={settings.codeWrap}
                  description={t("settings.codeWrapDescription")}
                  label={t("settings.codeWrap")}
                  onChange={(codeWrap) => updateSettings({ codeWrap })}
                />
                <SwitchRow
                  checked={settings.showTypingHints}
                  description={t("settings.typingHintsDescription")}
                  label={t("settings.typingHints")}
                  onChange={(showTypingHints) => updateSettings({ showTypingHints })}
                />
              </div>
            ) : null}

            {section === "appearance" ? (
              <div className="settings-group">
                <label className="settings-field settings-field--slider">
                  <span className="settings-field__copy">
                    <strong>{t("settings.contentWidth")}</strong>
                    <small>{t("settings.contentWidthDescription")}</small>
                  </span>
                  <span className="settings-slider">
                    <input
                      aria-label={t("settings.contentWidth")}
                      max="1600"
                      min="640"
                      onChange={(event) =>
                        updateSettings({ contentWidth: Number(event.currentTarget.value) })
                      }
                      step="40"
                      type="range"
                      value={settings.contentWidth}
                    />
                    <output>
                      {t("settings.pixels", { value: settings.contentWidth })}
                    </output>
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="settings-dialog__footer">
          <span>{t("settings.resetDescription")}</span>
          <button className="settings-reset-button" onClick={resetSettings} type="button">
            {t("common.reset")}
          </button>
        </footer>
      </section>
    </div>
  );
}
