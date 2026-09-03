import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { AppLocale } from "../../app/settings";
import { documentTemplates, templateLabels, type DocumentTemplate } from "./templates";
import {
  MAX_TEMPLATE_BYTES,
  type CustomDocumentTemplate,
  type DocumentTemplateLibrary,
  type TemplateLibraryAdapter,
} from "./types";
import { templateErrorMessage } from "./templateErrorMessage";
import "./TemplateDialog.css";

type Operation = "list" | "read" | "save" | "open" | null;

function fitsTemplateBudget(markdown: string): boolean {
  return (
    markdown.length <= MAX_TEMPLATE_BYTES &&
    new TextEncoder().encode(markdown).byteLength <= MAX_TEMPLATE_BYTES
  );
}

export function TemplateDialog({
  locale,
  onClose,
  onSelect,
  library,
  currentMarkdown,
}: {
  readonly locale: AppLocale;
  readonly onClose: () => void;
  readonly onSelect: (template: DocumentTemplate) => void;
  readonly library?: TemplateLibraryAdapter;
  readonly currentMarkdown?: string;
}) {
  const labels = templateLabels[locale];
  const panelRef = useRef<HTMLElement>(null);
  const active = useRef(true);
  const request = useRef(0);
  const [tab, setTab] = useState<"builtIn" | "custom">("builtIn");
  const [catalog, setCatalog] = useState<DocumentTemplateLibrary | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const id = useId();
  const tooLarge = currentMarkdown !== undefined && !fitsTemplateBudget(currentMarkdown);

  useLayoutEffect(() => {
    // Saving temporarily disables every control. Keep focus on the dialog itself.
    if (operation === "save") panelRef.current?.focus();
  }, [operation]);

  useEffect(() => {
    active.current = true;
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      active.current = false;
      request.current += 1;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  function close() {
    if (operation === "save") return;
    active.current = false;
    request.current += 1;
    onClose();
  }

  async function run(
    operationName: Exclude<Operation, null>,
    action: (isCurrent: () => boolean) => Promise<void>,
  ) {
    if (operation) return;
    const version = ++request.current;
    const isCurrent = () => active.current && request.current === version;
    setOperation(operationName);
    setError(null);
    try {
      await action(isCurrent);
    } catch (failure) {
      if (isCurrent()) setError(failure);
    } finally {
      if (isCurrent()) setOperation(null);
    }
  }

  function refresh() {
    if (!library) return;
    void run("list", async (isCurrent) => {
      const result = await library.list();
      if (isCurrent()) setCatalog(result);
    });
  }

  function changeTab(next: "builtIn" | "custom") {
    if (operation) return;
    setTab(next);
    setError(null);
    if (next === "custom" && catalog === null) refresh();
  }

  function selectCustom(template: CustomDocumentTemplate) {
    if (!library) return;
    void run("read", async (isCurrent) => {
      const result = await library.read(template.path);
      if (!isCurrent()) return;
      if (!fitsTemplateBudget(result.markdown)) throw { code: "templateTooLarge" };
      onSelect({
        id: `custom:${result.path}`,
        title: result.title,
        description: labels.custom,
        markdown: result.markdown,
      });
    });
  }

  function saveCurrent() {
    if (!library || currentMarkdown === undefined || tooLarge || !name.trim()) return;
    void run("save", async (isCurrent) => {
      const saved = await library.save(name, currentMarkdown);
      if (!isCurrent()) return;
      setName("");
      setSavedTitle(saved.title);
      // Saving copies the text; it does not create an editor session or save the source document.
      setCatalog((previous) =>
        previous
          ? {
              ...previous,
              templates: [
                ...previous.templates.filter((item) => item.path !== saved.path),
                saved,
              ].sort((left, right) => left.title.localeCompare(right.title, locale)),
            }
          : previous,
      );
      if (!catalog) {
        const result = await library.list();
        if (isCurrent()) setCatalog(result);
      }
    });
  }

  const status =
    operation === "save"
      ? labels.saving
      : operation === "open"
        ? labels.opening
        : operation
          ? labels.loading
          : savedTitle
            ? labels.saved(savedTitle)
            : null;

  return (
    <div
      className="settings-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={panelRef}
        className="template-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key !== "Tab") return;
          const controls = panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]):not([tabindex="-1"]), input:not([disabled])',
          );
          const first = controls?.[0],
            last = controls?.[controls.length - 1];
          if (!first || !last) {
            event.preventDefault();
            panelRef.current?.focus();
            return;
          }
          if (!Array.from(controls).includes(document.activeElement as HTMLElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2>{labels.title}</h2>
        <p>{labels.hint}</p>
        <div className="template-dialog__tabs" role="tablist" aria-label={labels.title}>
          {(["builtIn", "custom"] as const).map((value) => (
            <button
              key={value}
              id={`${id}-${value}`}
              role="tab"
              type="button"
              aria-selected={tab === value}
              aria-controls={`${id}-panel`}
              tabIndex={tab === value ? 0 : -1}
              disabled={operation !== null}
              onClick={() => changeTab(value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = value === "builtIn" ? "custom" : "builtIn";
                changeTab(next);
                panelRef.current
                  ?.querySelector<HTMLButtonElement>(`[id="${id}-${next}"]`)
                  ?.focus();
              }}
            >
              {labels[value]}
            </button>
          ))}
        </div>
        <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
          {tab === "builtIn" ? (
            <div className="template-dialog__choices">
              {documentTemplates(locale).map((template) => (
                <button
                  key={template.id}
                  disabled={operation !== null}
                  onClick={() => onSelect(template)}
                  type="button"
                >
                  <strong>{template.title}</strong>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>
          ) : !library ? (
            <p>{labels.unavailable}</p>
          ) : (
            <>
              <p>{labels.customHint}</p>
              <div className="template-dialog__library-actions">
                <button type="button" disabled={operation !== null} onClick={refresh}>
                  {labels.refresh}
                </button>
                <button
                  type="button"
                  disabled={operation !== null || !catalog}
                  onClick={() => {
                    if (catalog)
                      void run("open", async () =>
                        library.openDirectory(catalog.directoryPath),
                      );
                  }}
                >
                  {labels.openDirectory}
                </button>
              </div>
              {catalog && (
                <p className="template-dialog__directory">
                  <span>{labels.directory}</span>
                  <code>{catalog.directoryPath}</code>
                </p>
              )}
              {catalog?.skippedCount ? (
                <p className="template-dialog__warning">
                  {labels.skipped(catalog.skippedCount)}
                </p>
              ) : null}
              {catalog?.truncated ? (
                <p className="template-dialog__warning">{labels.truncated}</p>
              ) : null}
              <div className="template-dialog__choices">
                {catalog?.templates.map((template) => (
                  <button
                    key={template.path}
                    type="button"
                    disabled={operation !== null}
                    onClick={() => selectCustom(template)}
                  >
                    <strong>{template.title}</strong>
                    <span>
                      {Math.max(1, Math.ceil(template.sizeBytes / 1024))} KiB · Markdown
                    </span>
                  </button>
                ))}
                {catalog?.templates.length === 0 && <p>{labels.empty}</p>}
              </div>
              <form
                className="template-dialog__save"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveCurrent();
                }}
              >
                <h3>{labels.saveTitle}</h3>
                <p>
                  {currentMarkdown === undefined
                    ? labels.noCurrentDocument
                    : tooLarge
                      ? labels.tooLarge
                      : labels.saveHint}
                </p>
                <label htmlFor={`${id}-name`}>{labels.name}</label>
                <div className="template-dialog__save-controls">
                  <input
                    id={`${id}-name`}
                    value={name}
                    placeholder={labels.namePlaceholder}
                    disabled={
                      operation !== null || currentMarkdown === undefined || tooLarge
                    }
                    onChange={(event) => {
                      setName(event.target.value);
                      setSavedTitle(null);
                    }}
                  />
                  <button
                    type="submit"
                    disabled={
                      operation !== null ||
                      currentMarkdown === undefined ||
                      tooLarge ||
                      !name.trim()
                    }
                  >
                    {labels.save}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
        {status && (
          <p className="template-dialog__status" role="status">
            {status}
          </p>
        )}
        {error !== null && (
          <p className="template-dialog__error" role="alert">
            {templateErrorMessage(error, locale)}
          </p>
        )}
        <footer>
          <button type="button" disabled={operation === "save"} onClick={close}>
            {labels.cancel}
          </button>
        </footer>
      </section>
    </div>
  );
}
