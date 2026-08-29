import { useState } from "react";

import type { WorkspaceNode } from "../../infrastructure/tauri/desktopAdapter";
import { FolderIcon } from "../../app/shell/icons";
import "./WorkspaceTree.css";

export interface WorkspaceTreeProps {
  readonly nodes: readonly WorkspaceNode[];
  readonly activePath?: string;
  readonly onOpen: (path: string) => void;
}

function FileGlyph() {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 18 18" width="16">
      <path
        d="M4 2.5h6l4 4v9H4z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <path d="M10 2.5v4h4M6.5 10h5M6.5 12.5h4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function TreeNode({
  node,
  activePath,
  onOpen,
  depth,
}: {
  readonly node: WorkspaceNode;
  readonly activePath?: string;
  readonly onOpen: (path: string) => void;
  readonly depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const children = node.children ?? [];

  if (node.kind === "directory") {
    return (
      <li>
        <button
          aria-expanded={expanded}
          className="workspace-tree__row"
          onClick={() => setExpanded((value) => !value)}
          style={{ paddingInlineStart: 10 + depth * 14 }}
          type="button"
        >
          <span className="workspace-tree__chevron" aria-hidden="true">
            {expanded ? "⌄" : "›"}
          </span>
          <FolderIcon />
          <span title={node.relativePath}>{node.name}</span>
        </button>
        {expanded && children.length > 0 && (
          <ul>
            {children.map((child) => (
              <TreeNode
                activePath={activePath}
                depth={depth + 1}
                key={child.path}
                node={child}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        aria-current={activePath === node.path ? "page" : undefined}
        className="workspace-tree__row workspace-tree__row--file"
        onClick={() => onOpen(node.path)}
        style={{ paddingInlineStart: 28 + depth * 14 }}
        title={node.relativePath}
        type="button"
      >
        <FileGlyph />
        <span>{node.name}</span>
      </button>
    </li>
  );
}

export function WorkspaceTree({ nodes, activePath, onOpen }: WorkspaceTreeProps) {
  return (
    <ul className="workspace-tree" aria-label="工作区文件">
      {nodes.map((node) => (
        <TreeNode
          activePath={activePath}
          depth={0}
          key={node.path}
          node={node}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
