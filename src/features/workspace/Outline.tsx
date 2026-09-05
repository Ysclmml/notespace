import "./Outline.css";
import { memo, useMemo } from "react";
import { extractOutline, type OutlineItem } from "./outlineModel";

interface OutlineProps {
  readonly markdown: string;
  readonly onNavigate?: (item: OutlineItem) => void;
  readonly label?: string;
  readonly emptyLabel?: string;
  readonly lineLabel?: (line: number) => string;
}

export const Outline = memo(function Outline({
  markdown,
  onNavigate,
  label = "文档大纲",
  emptyLabel = "当前文档没有标题",
  lineLabel = (line) => `第 ${line} 行`,
}: OutlineProps) {
  const items = useMemo(() => extractOutline(markdown), [markdown]);
  if (items.length === 0) {
    return <p className="outline-empty">{emptyLabel}</p>;
  }

  return (
    <nav className="outline" aria-label={label}>
      {items.map((item) => (
        <button
          className="outline__item"
          key={`${item.line}:${item.title}`}
          onClick={() => onNavigate?.(item)}
          style={{ paddingInlineStart: 12 + (item.level - 1) * 14 }}
          title={lineLabel(item.line)}
          type="button"
        >
          {item.title}
        </button>
      ))}
    </nav>
  );
});
