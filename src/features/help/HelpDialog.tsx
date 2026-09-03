import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppSettings } from "../../app/settings";
import { FORMATTING_ACTIONS, formatShortcut } from "../shortcuts/shortcuts";
import { getFormattingActionLabel } from "../shortcuts/labels";
import { helpSections } from "./helpContent";
import "./HelpDialog.css";

export function HelpDialog({ onClose }: { readonly onClose: () => void }) {
  const { settings } = useAppSettings();
  const zh = settings.locale === "zh-CN";
  const sections = helpSections(settings.locale);
  const [selected, setSelected] = useState("start");
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const fields = panelRef.current?.querySelectorAll<HTMLElement>(
        "button, [tabindex='0']",
      );
      const first = fields?.[0],
        last = fields?.[fields.length - 1];
      if (!first || !last) return;
      if (
        !panelRef.current?.contains(document.activeElement) ||
        document.activeElement === (event.shiftKey ? first : last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", keyDown, true);
    return () => {
      window.removeEventListener("keydown", keyDown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const section = sections.find((item) => item.id === selected);
  return (
    <div
      className="help-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={zh ? "使用帮助" : "User guide"}
      >
        <header className="help-dialog__header">
          <div>
            <h2>{zh ? "使用帮助" : "User guide"}</h2>
            <p>
              {zh ? "NoteSpace · 本地写作与阅读" : "NoteSpace · Local writing and reading"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={zh ? "关闭使用帮助" : "Close user guide"}
          >
            ×
          </button>
        </header>
        <div className="help-dialog__layout">
          <nav aria-label={zh ? "帮助主题" : "Help topics"}>
            {[
              ...sections.map(({ id, title }) => ({ id, title })),
              { id: "shortcuts", title: zh ? "快捷键速查" : "Shortcut reference" },
            ].map((item) => (
              <button
                type="button"
                key={item.id}
                aria-current={selected === item.id ? "page" : undefined}
                onClick={() => {
                  setSelected(item.id);
                  if (contentRef.current) contentRef.current.scrollTop = 0;
                }}
              >
                {item.title}
              </button>
            ))}
          </nav>
          <div className="help-dialog__content" ref={contentRef} tabIndex={0}>
            {section ? (
              <>
                <h3>{section.title}</h3>
                <p className="help-dialog__intro">{section.intro}</p>
                {section.items.map((item) => (
                  <section key={item.title}>
                    <h4>{item.title}</h4>
                    <p>{item.text}</p>
                  </section>
                ))}
              </>
            ) : (
              <>
                <h3>{zh ? "快捷键速查" : "Shortcut reference"}</h3>
                <p className="help-dialog__intro">
                  {zh
                    ? "Mac 使用 Cmd（⌘），Windows / Linux 使用 Ctrl。格式键显示你当前的配置，可在设置 → 快捷键中修改或恢复。"
                    : "Mac uses Cmd (⌘); Windows / Linux use Ctrl. Formatting keys show your current settings and can be customized or reset in Settings → Shortcuts."}
                </p>
                <dl className="help-dialog__shortcuts">
                  {[
                    [zh ? "快速打开文件" : "Quick open", "Mod+K"],
                    [zh ? "全文搜索" : "Search contents", "Mod+Shift+F"],
                    [zh ? "当前页查找 / 替换" : "Find / replace in page", "Mod+F"],
                    [zh ? "保存" : "Save", "Mod+S"],
                    [zh ? "可视 / 源码" : "Visual / source", "Mod+/"],
                    [zh ? "专注模式" : "Focus mode", "Mod+Shift+Enter"],
                  ].map(([label, binding]) => (
                    <div key={binding}>
                      <dt>{label}</dt>
                      <dd>
                        <kbd>{formatShortcut(binding ?? null)}</kbd>
                      </dd>
                    </div>
                  ))}
                  {FORMATTING_ACTIONS.map((action) => (
                    <div key={action}>
                      <dt>{getFormattingActionLabel(action, settings.locale)}</dt>
                      <dd>
                        <kbd>
                          {formatShortcut(settings.shortcuts[action]) ||
                            (zh ? "未设置" : "Not set")}
                        </kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p>
                  {zh
                    ? "标题快捷键作用于所在或选中的段落，不是 Word 字号；普通代码文件和对话框输入框不会触发 Markdown 格式。"
                    : "Heading shortcuts format paragraphs, not font point sizes. Markdown formatting does not run in code files or dialog inputs."}
                </p>
              </>
            )}
          </div>
        </div>
        <footer>
          {zh ? "随应用提供，无需联网" : "Included with the app · Works offline"}
          <span>Esc {zh ? "关闭" : "to close"}</span>
        </footer>
      </section>
    </div>
  );
}
