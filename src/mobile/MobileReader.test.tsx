import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileReader } from "./MobileReader";

describe("MobileReader math", () => {
  it("renders saved Markdown formulas through the safe reader surface", () => {
    const { container } = render(
      <MobileReader
        document={{
          id: "document-1",
          workspaceId: "workspace-1",
          workspaceName: "公式笔记",
          title: "旋转位置编码",
          relativePath: "notes/formula.md",
          markdown: String.raw`正文中的 \(q'_t = R_t q_t\)。`,
        }}
        onBack={vi.fn()}
        onPositionChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".mobile-reader .katex")).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
  });
});
