import { useId, useState, type KeyboardEvent } from "react";

import { useAppSettings } from "../../app/settings";
import { getFormattingActionLabel, shortcutLabels } from "../shortcuts/labels";
import {
  DEFAULT_SHORTCUTS,
  FORMATTING_ACTIONS,
  findShortcutConflict,
  formatShortcut,
  shortcutFromEvent,
  type FormattingAction,
  type ShortcutConflict,
} from "../shortcuts/shortcuts";
import "./ShortcutSettings.css";

type RecordingError = { readonly action: FormattingAction } & (
  | { readonly kind: "invalid" }
  | { readonly kind: "reserved" }
  | { readonly kind: "action"; readonly owner: FormattingAction }
);

export function ShortcutSettings() {
  const { settings, updateSettings } = useAppSettings();
  const labels = shortcutLabels[settings.locale];
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<FormattingAction | null>(null);
  const [error, setError] = useState<RecordingError | null>(null);
  const guidanceId = useId();
  const needle = query.toLowerCase().trim();
  const actions = FORMATTING_ACTIONS.filter((action) =>
    [
      action,
      getFormattingActionLabel(action, "zh-CN"),
      getFormattingActionLabel(action, "en-US"),
      formatShortcut(settings.shortcuts[action]),
    ].some((value) => value.toLowerCase().includes(needle)),
  );

  const reportConflict = (action: FormattingAction, conflict: ShortcutConflict) => {
    setError(
      conflict.kind === "reserved"
        ? { action, kind: "reserved" }
        : { action, kind: "action", owner: conflict.action },
    );
  };

  const applyBinding = (action: FormattingAction, binding: string | null) => {
    const conflict = binding
      ? findShortcutConflict(binding, action, settings.shortcuts)
      : null;
    if (conflict) {
      reportConflict(action, conflict);
      return;
    }
    updateSettings({ shortcuts: { ...settings.shortcuts, [action]: binding } });
    setError(null);
    setRecording(null);
  };

  const recordKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!recording) return;
    if (event.key === "Tab") {
      setRecording(null);
      setError(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      setRecording(null);
      setError(null);
      return;
    }
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
    const binding = shortcutFromEvent(event.nativeEvent);
    if (!binding) {
      setError({ action: recording, kind: "invalid" });
      return;
    }
    applyBinding(recording, binding);
  };

  return (
    <div className="shortcut-settings" onKeyDownCapture={recordKey}>
      <p className="shortcut-settings__description">{labels.description}</p>
      <input
        aria-label={labels.search}
        className="shortcut-settings__search"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setRecording(null);
          setError(null);
        }}
        placeholder={labels.search}
        type="search"
        value={query}
      />
      <p className="shortcut-settings__guidance" id={guidanceId}>
        {labels.guidance}
      </p>
      <div className="shortcut-settings__list">
        {actions.map((action) => {
          const name = getFormattingActionLabel(action, settings.locale);
          const binding = settings.shortcuts[action];
          const active = recording === action;
          const issue = error?.action === action ? error : null;
          return (
            <div className="shortcut-settings__row" key={action}>
              <div className="shortcut-settings__action">
                <strong>{name}</strong>
                <small>{labels.default(formatShortcut(DEFAULT_SHORTCUTS[action]))}</small>
              </div>
              <button
                aria-describedby={guidanceId}
                aria-label={labels.recordAction(name)}
                aria-pressed={active}
                className="shortcut-settings__binding"
                onBlur={() =>
                  setRecording((current) => (current === action ? null : current))
                }
                onClick={(event) => {
                  event.currentTarget.focus();
                  setRecording(active ? null : action);
                  setError(null);
                }}
                type="button"
              >
                {active ? (
                  labels.recording
                ) : (
                  <kbd>{formatShortcut(binding) || labels.empty}</kbd>
                )}
              </button>
              <div className="shortcut-settings__buttons">
                <button
                  aria-label={labels.clearAction(name)}
                  disabled={binding === null}
                  onClick={() => applyBinding(action, null)}
                  type="button"
                >
                  {labels.clear}
                </button>
                <button
                  aria-label={labels.resetAction(name)}
                  disabled={binding === DEFAULT_SHORTCUTS[action]}
                  onClick={() => applyBinding(action, DEFAULT_SHORTCUTS[action])}
                  type="button"
                >
                  {labels.reset}
                </button>
              </div>
              {issue && (
                <p className="shortcut-settings__error" role="alert">
                  {issue.kind === "action"
                    ? labels.conflict(
                        getFormattingActionLabel(issue.owner, settings.locale),
                      )
                    : labels[issue.kind]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!actions.length && <p>{labels.noMatches}</p>}
      <div className="shortcut-settings__footer">
        {recording && (
          <button
            onClick={() => {
              setRecording(null);
              setError(null);
            }}
            type="button"
          >
            {labels.cancel}
          </button>
        )}
        <button
          onClick={() => {
            updateSettings({ shortcuts: DEFAULT_SHORTCUTS });
            setRecording(null);
            setError(null);
          }}
          type="button"
        >
          {labels.resetAll}
        </button>
      </div>
    </div>
  );
}
