import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { normalizeWorkspaceImageDirectoryPath } from "../workspace/workspaceHistory";
import "./WorkspaceImageSettingsDialog.css";

export interface WorkspaceImageSettingsLabels {
  readonly title: string;
  readonly description: string;
  readonly sameDirectory: string;
  readonly sameDirectoryDescription: string;
  readonly customDirectory: string;
  readonly customDirectoryDescription: string;
  readonly directoryPath: string;
  readonly chooseDirectory: string;
  readonly chooseDirectoryHint: string;
  readonly chooseDirectoryError: string;
  readonly cancel: string;
  readonly save: string;
}

export interface WorkspaceImageSettingsDialogProps {
  readonly workspaceName: string;
  readonly imageDirectoryPath: string | null;
  readonly labels: WorkspaceImageSettingsLabels;
  readonly onChooseDirectory: () => Promise<string | null>;
  readonly onSave: (directoryPath: string | null) => void;
  readonly onClose: () => void;
}

export function WorkspaceImageSettingsDialog({
  workspaceName,
  imageDirectoryPath,
  labels,
  onChooseDirectory,
  onSave,
  onClose,
}: WorkspaceImageSettingsDialogProps) {
  const titleId = useId();
  const helpId = useId();
  const groupId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const callbacks = useRef({ onClose });
  const mounted = useRef(false);
  const choosingRef = useRef(false);
  const [directoryPath, setDirectoryPath] = useState(() =>
    normalizeWorkspaceImageDirectoryPath(imageDirectoryPath),
  );
  const [useCustomDirectory, setUseCustomDirectory] = useState(() =>
    Boolean(normalizeWorkspaceImageDirectoryPath(imageDirectoryPath)),
  );
  const [choosing, setChoosing] = useState(false);
  const [hasError, setHasError] = useState(false);

  useLayoutEffect(() => {
    callbacks.current = { onClose };
  }, [onClose]);

  useEffect(() => {
    mounted.current = true;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    formRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();

    const keyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        event.stopImmediatePropagation();
        if (!["a", "c", "v", "x", "z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault();
        }
      }
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacks.current.onClose();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          formRef.current?.querySelectorAll<HTMLElement>(
            "input:not(:disabled):checked, textarea:not(:disabled), button:not(:disabled)",
          ) ?? [],
        );
        const first = controls[0];
        const last = controls.at(-1);
        const focusOutside = !formRef.current?.contains(document.activeElement);
        if (focusOutside || document.activeElement === (event.shiftKey ? first : last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    window.addEventListener("keydown", keyDown, true);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", keyDown, true);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  const chooseDirectory = async () => {
    if (choosingRef.current) return;
    choosingRef.current = true;
    setChoosing(true);
    setHasError(false);
    try {
      const selectedPath = await onChooseDirectory();
      if (!mounted.current || selectedPath === null) return;
      const normalized = normalizeWorkspaceImageDirectoryPath(selectedPath);
      if (normalized) setDirectoryPath(normalized);
      else setHasError(true);
    } catch {
      if (mounted.current) setHasError(true);
    } finally {
      choosingRef.current = false;
      if (mounted.current) setChoosing(false);
    }
  };

  return createPortal(
    <div
      className="workspace-image-settings-layer"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <form
        aria-describedby={helpId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="workspace-image-settings"
        onSubmit={(event) => {
          event.preventDefault();
          if (!choosingRef.current && (!useCustomDirectory || directoryPath)) {
            onSave(useCustomDirectory ? directoryPath : null);
          }
        }}
        ref={formRef}
        role="dialog"
      >
        <header>
          <h2 id={titleId}>{labels.title}</h2>
          <p className="workspace-image-settings__workspace">{workspaceName}</p>
        </header>
        <div className="workspace-image-settings__body">
          <p id={helpId}>{labels.description}</p>
          <fieldset aria-label={labels.title} disabled={choosing}>
            <label className="workspace-image-settings__option">
              <input
                aria-label={labels.sameDirectory}
                checked={!useCustomDirectory}
                name={groupId}
                onChange={() => {
                  setUseCustomDirectory(false);
                  setHasError(false);
                }}
                type="radio"
              />
              <span>
                <strong>{labels.sameDirectory}</strong>
                <small>{labels.sameDirectoryDescription}</small>
              </span>
            </label>
            <label className="workspace-image-settings__option">
              <input
                aria-label={labels.customDirectory}
                checked={useCustomDirectory}
                name={groupId}
                onChange={() => {
                  setUseCustomDirectory(true);
                  setHasError(false);
                }}
                type="radio"
              />
              <span>
                <strong>{labels.customDirectory}</strong>
                <small>{labels.customDirectoryDescription}</small>
              </span>
            </label>
          </fieldset>
          {useCustomDirectory && (
            <div className="workspace-image-settings__destination">
              <label>
                <span>{labels.directoryPath}</span>
                <textarea
                  placeholder={labels.chooseDirectoryHint}
                  readOnly
                  rows={3}
                  value={directoryPath ?? ""}
                />
              </label>
              <button
                aria-busy={choosing}
                disabled={choosing}
                onClick={() => void chooseDirectory()}
                type="button"
              >
                {labels.chooseDirectory}
              </button>
            </div>
          )}
          {hasError && (
            <p className="workspace-image-settings__error" role="alert">
              {labels.chooseDirectoryError}
            </p>
          )}
        </div>
        <footer>
          <button onClick={onClose} type="button">
            {labels.cancel}
          </button>
          <button
            className="workspace-image-settings__save"
            disabled={choosing || (useCustomDirectory && !directoryPath)}
            type="submit"
          >
            {labels.save}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
