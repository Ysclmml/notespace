import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceSearchRoot } from "./types";

export function WorkspaceScopePicker({
  allLabel,
  disabled,
  label,
  onChange,
  value,
  workspaces,
}: {
  readonly allLabel: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (path: string) => void;
  readonly value: string;
  readonly workspaces: readonly WorkspaceSearchRoot[];
}) {
  const options = [{ path: "", label: `${allLabel} (${workspaces.length})` }].concat(
    workspaces.map((root) => ({ path: root.path, label: root.path })),
  );
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.path === value),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const hostRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, open]);

  const openAt = (index: number) => {
    setActiveIndex((index + options.length) % options.length);
    setOpen(true);
  };
  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.path);
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  };
  const move = (index: number) => {
    setActiveIndex((index + options.length) % options.length);
  };

  return (
    <div
      className="workspace-search__scope-picker"
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      ref={hostRef}
    >
      <span className="workspace-search__control-label">{label}</span>
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="workspace-search__scope-button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            openAt(
              open
                ? activeIndex + (event.key === "ArrowDown" ? 1 : -1)
                : selectedIndex + (event.key === "ArrowDown" ? 1 : -1),
            );
          }
        }}
        ref={buttonRef}
        role="combobox"
        type="button"
      >
        <span title={options[selectedIndex]?.label}>{options[selectedIndex]?.label}</span>
        <span aria-hidden="true" className="workspace-search__scope-chevron">
          <svg fill="none" viewBox="0 0 20 20">
            <path
              d="m5.25 7.5 4.75 5 4.75-5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </span>
      </button>
      {open && (
        <div className="workspace-search__scope-popover">
          <ul aria-label={label} id={listboxId} role="listbox">
            {options.map((option, index) => (
              <li key={option.path || "all"} role="presentation">
                <button
                  aria-selected={index === selectedIndex}
                  className="workspace-search__scope-option"
                  onClick={() => select(index)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(false);
                      buttonRef.current?.focus({ preventScroll: true });
                    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      event.stopPropagation();
                      move(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
                    } else if (event.key === "Home" || event.key === "End") {
                      event.preventDefault();
                      event.stopPropagation();
                      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      select(index);
                    }
                  }}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  tabIndex={index === activeIndex ? 0 : -1}
                  title={option.label}
                  type="button"
                >
                  <span aria-hidden="true" className="workspace-search__scope-check">
                    {index === selectedIndex ? "✓" : ""}
                  </span>
                  <span>{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
