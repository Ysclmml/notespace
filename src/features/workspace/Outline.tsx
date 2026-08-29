import "./Outline.css";
import { extractOutline, type OutlineItem } from "./outlineModel";

interface OutlineProps {
  readonly markdown: string;
  readonly onNavigate?: (item: OutlineItem) => void;
}

export function Outline({ markdown, onNavigate }: OutlineProps) {
  const items = extractOutline(markdown);
  if (items.length === 0) {
    return <p className="outline-empty">当前文档没有标题</p>;
  }

  return (
    <nav className="outline" aria-label="文档大纲">
      {items.map((item) => (
        <button
          className="outline__item"
          key={`${item.line}:${item.title}`}
          onClick={() => onNavigate?.(item)}
          style={{ paddingInlineStart: 12 + (item.level - 1) * 14 }}
          title={`第 ${item.line} 行`}
          type="button"
        >
          {item.title}
        </button>
      ))}
    </nav>
  );
}
