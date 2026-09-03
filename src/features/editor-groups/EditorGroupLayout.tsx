import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import type { Tab } from "../../app/state";
import { TAB_DRAG_MIME } from "./EditorGroupTabs";
import "./EditorGroupLayout.css";

interface LayoutGroup {
  readonly id: string;
  readonly tabs: readonly Tab[];
  readonly activeTab: Tab | undefined;
}

interface EditorGroupLayoutProps {
  readonly groups: readonly LayoutGroup[];
  readonly focusedGroupId: string;
  readonly draggedTabId: string | null;
  readonly groupLabel: (index: number) => string;
  readonly resizeLabel: (index: number) => string;
  readonly dropLabel: string;
  readonly onActivateGroup: (groupId: string) => void;
  readonly onMoveTab: (tabId: string, groupId: string) => void;
  readonly onDragTabChange: (tabId: string | null) => void;
  readonly renderTabs: (group: LayoutGroup, index: number) => ReactNode;
  readonly renderTab: (tab: Tab, focused: boolean) => ReactNode;
  readonly renderEmpty: (groupId: string) => ReactNode;
}

const MIN_GROUP_WIDTH = 280;
const DIVIDER_WIDTH = 6;

interface ResizeGesture {
  readonly pointerId: number;
  readonly x: number;
  readonly leftId: string;
  readonly rightId: string;
  readonly leftWidth: number;
  readonly totalWidth: number;
  readonly totalWeight: number;
}

/** A flat horizontal layout. Moving a Tab changes its grid column, not its editor. */
export function EditorGroupLayout({
  groups,
  focusedGroupId,
  draggedTabId,
  groupLabel,
  resizeLabel,
  dropLabel,
  onActivateGroup,
  onMoveTab,
  onDragTabChange,
  renderTabs,
  renderTab,
  renderEmpty,
}: EditorGroupLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef(new Map<string, HTMLDivElement>());
  const resizingRef = useRef<ResizeGesture | null>(null);
  const [weights, setWeights] = useState<Readonly<Record<string, number>>>({});
  const [resizing, setResizing] = useState(false);
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const [lastDraggedTabId, setLastDraggedTabId] = useState(draggedTabId);
  const groupOrder = JSON.stringify(groups.map((group) => group.id));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const revealFocusedGroup = () => {
      const header = headersRef.current.get(focusedGroupId);
      const width = container.clientWidth;
      if (!header || width <= 0) return;
      const bounds = header.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const left = container.getBoundingClientRect().left + container.clientLeft;
      const right = left + width;
      const offset =
        bounds.width > width || bounds.left < left
          ? bounds.left - left
          : bounds.right > right
            ? bounds.right - right
            : 0;
      if (Math.abs(offset) < 1) return;
      // Only this horizontal viewport moves. Never scroll the editor or page.
      container.scrollLeft = Math.max(
        0,
        Math.min(container.scrollWidth - width, container.scrollLeft + offset),
      );
    };

    revealFocusedGroup();
    let previousWidth = container.clientWidth;
    const revealAfterNarrowing = () => {
      const width = container.clientWidth;
      if (width > 0 && (previousWidth === 0 || width < previousWidth)) {
        revealFocusedGroup();
      }
      previousWidth = width;
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(revealAfterNarrowing);
    observer?.observe(container);
    window.addEventListener("resize", revealAfterNarrowing);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", revealAfterNarrowing);
    };
    // Body edits, tab changes within the group and column resizing must not
    // undo a user's manual horizontal scroll; only destination/layout changes do.
  }, [focusedGroupId, groupOrder]);

  if (lastDraggedTabId !== draggedTabId) {
    setLastDraggedTabId(draggedTabId);
    setDropGroupId(null);
  }

  const weightOf = (id: string) => weights[id] ?? 1;
  const isInternalDrag = (event: DragEvent) =>
    Boolean(
      draggedTabId &&
      Array.from(event.dataTransfer.types).includes(TAB_DRAG_MIME) &&
      !Array.from(event.dataTransfer.types).includes("Files"),
    );

  const resizeTo = (
    leftId: string,
    rightId: string,
    totalWeight: number,
    ratio: number,
  ) => {
    setWeights((current) => ({
      ...current,
      [leftId]: totalWeight * ratio,
      [rightId]: totalWeight * (1 - ratio),
    }));
  };

  const startResize = (
    event: PointerEvent<HTMLDivElement>,
    leftId: string,
    rightId: string,
  ) => {
    if (event.button !== 0 || event.ctrlKey) return;
    const leftWidth = headersRef.current.get(leftId)?.getBoundingClientRect().width ?? 0;
    const rightWidth = headersRef.current.get(rightId)?.getBoundingClientRect().width ?? 0;
    if (!leftWidth || !rightWidth) return;
    event.preventDefault();
    resizingRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      leftId,
      rightId,
      leftWidth,
      totalWidth: leftWidth + rightWidth,
      totalWeight: weightOf(leftId) + weightOf(rightId),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizing(true);
  };

  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = resizingRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const nextWidth = Math.max(
      MIN_GROUP_WIDTH,
      Math.min(
        gesture.totalWidth - MIN_GROUP_WIDTH,
        gesture.leftWidth + event.clientX - gesture.x,
      ),
    );
    resizeTo(
      gesture.leftId,
      gesture.rightId,
      gesture.totalWeight,
      nextWidth / gesture.totalWidth,
    );
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizingRef.current?.pointerId !== event.pointerId) return;
    resizingRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (
    event: KeyboardEvent<HTMLDivElement>,
    leftId: string,
    rightId: string,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
    event.preventDefault();
    const total = weightOf(leftId) + weightOf(rightId);
    const ratio = weightOf(leftId) / total;
    const leftWidth = headersRef.current.get(leftId)?.getBoundingClientRect().width ?? 0;
    const rightWidth = headersRef.current.get(rightId)?.getBoundingClientRect().width ?? 0;
    const minimum = Math.min(0.5, MIN_GROUP_WIDTH / (leftWidth + rightWidth || 1000));
    const next =
      event.key === "Enter"
        ? 0.5
        : event.key === "Home"
          ? minimum
          : event.key === "End"
            ? 1 - minimum
            : ratio + (event.key === "ArrowLeft" ? -0.04 : 0.04);
    resizeTo(leftId, rightId, total, Math.max(minimum, Math.min(1 - minimum, next)));
  };

  const dropOnGroup = (event: DragEvent<HTMLElement>, groupId: string) => {
    if (!isInternalDrag(event)) return;
    const tabId = event.dataTransfer.getData(TAB_DRAG_MIME);
    if (!tabId || tabId !== draggedTabId) return;
    event.preventDefault();
    event.stopPropagation();
    onMoveTab(tabId, groupId);
    setDropGroupId(null);
    onDragTabChange(null);
  };

  return (
    <div
      className={`editor-groups${resizing ? " editor-groups--resizing" : ""}`}
      ref={containerRef}
      style={{
        gridTemplateColumns: groups
          .map(
            (group) =>
              `minmax(${groups.length === 1 ? 0 : MIN_GROUP_WIDTH}px, ${weightOf(group.id)}fr)`,
          )
          .join(` ${DIVIDER_WIDTH}px `),
      }}
    >
      {groups.map((group, index) => (
        <div
          className="editor-group-header"
          data-focused={group.id === focusedGroupId}
          data-group-header={group.id}
          key={`header-${group.id}`}
          ref={(element) => {
            if (element) headersRef.current.set(group.id, element);
            else headersRef.current.delete(group.id);
          }}
          style={{ gridColumn: index * 2 + 1 }}
        >
          {renderTabs(group, index)}
        </div>
      ))}
      {groups.slice(1).map((group, index) => {
        const left = groups[index];
        if (!left) return null;
        return (
          <div
            aria-label={resizeLabel(index + 1)}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(
              (100 * weightOf(left.id)) / (weightOf(left.id) + weightOf(group.id)),
            )}
            className="editor-group-divider"
            key={`divider-${group.id}`}
            onDoubleClick={() =>
              resizeTo(left.id, group.id, weightOf(left.id) + weightOf(group.id), 0.5)
            }
            onKeyDown={(event) => resizeWithKeyboard(event, left.id, group.id)}
            onLostPointerCapture={(event) => {
              if (resizingRef.current?.pointerId === event.pointerId) {
                resizingRef.current = null;
                setResizing(false);
              }
            }}
            onPointerDown={(event) => startResize(event, left.id, group.id)}
            onPointerMove={moveResize}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            role="separator"
            style={{ gridColumn: (index + 1) * 2 }}
            tabIndex={0}
          />
        );
      })}
      {groups.map((group, index) => (
        <section
          aria-label={groupLabel(index + 1)}
          className={`editor-tab-panel${draggedTabId && dropGroupId === group.id ? " editor-tab-panel--drop-target" : ""}`}
          data-editor-group-id={group.id}
          data-tab-id={group.activeTab?.id}
          data-focused={group.id === focusedGroupId}
          key={group.activeTab?.id ?? `empty-${group.id}`}
          onDragEnter={(event) => {
            if (isInternalDrag(event)) {
              event.preventDefault();
              setDropGroupId(group.id);
            }
          }}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setDropGroupId(null);
            }
          }}
          onDragOver={(event) => {
            if (!isInternalDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => dropOnGroup(event, group.id)}
          onFocusCapture={() => onActivateGroup(group.id)}
          onPointerDownCapture={(event) => {
            if (event.button === 0 && !event.ctrlKey) onActivateGroup(group.id);
          }}
          style={{ gridColumn: index * 2 + 1 }}
        >
          {group.activeTab
            ? renderTab(group.activeTab, group.id === focusedGroupId)
            : renderEmpty(group.id)}
          {draggedTabId && dropGroupId === group.id && (
            <div className="editor-tab-panel__drop-hint" aria-hidden="true">
              {dropLabel}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
