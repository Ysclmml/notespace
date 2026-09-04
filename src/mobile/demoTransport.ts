import { MockMobileTransport } from "./mockTransport";

export function createDemoMobileTransport() {
  return new MockMobileTransport({
    computers: [
      {
        id: "demo-computer",
        name: "NoteSpace 内置示例",
        address: "不连接真实电脑",
      },
    ],
    workspaces: [
      { id: "demo-workspace", name: "产品笔记", documentCount: 3 },
      { id: "reading-workspace", name: "阅读摘录", documentCount: 1 },
    ],
    directories: {
      "demo-workspace:root": {
        workspaceId: "demo-workspace",
        directoryId: null,
        name: "产品笔记",
        breadcrumbs: [{ id: null, name: "产品笔记" }],
        entries: [
          { id: "demo-folder", name: "设计", kind: "directory", detail: "2 篇文档" },
          { id: "demo-welcome", name: "移动阅读说明.md", kind: "document" },
        ],
      },
      "demo-workspace:demo-folder": {
        workspaceId: "demo-workspace",
        directoryId: "demo-folder",
        name: "设计",
        breadcrumbs: [
          { id: null, name: "产品笔记" },
          { id: "demo-folder", name: "设计" },
        ],
        entries: [
          { id: "demo-design", name: "移动端阅读设计.md", kind: "document" },
          { id: "demo-security", name: "局域网访问边界.md", kind: "document" },
        ],
      },
      "reading-workspace:root": {
        workspaceId: "reading-workspace",
        directoryId: null,
        name: "阅读摘录",
        breadcrumbs: [{ id: null, name: "阅读摘录" }],
        entries: [{ id: "demo-reading", name: "本周阅读.md", kind: "document" }],
      },
    },
    documents: {
      "demo-welcome": {
        id: "demo-welcome",
        workspaceId: "demo-workspace",
        workspaceName: "产品笔记",
        title: "移动阅读说明",
        relativePath: "移动阅读说明.md",
        updatedAt: "内置示例",
        markdown: `# 欢迎使用移动阅读

这是一个随安装包提供的**只读界面示例**，只使用合成内容，不会连接或读取真实电脑。

Android 应用可读取同一局域网中、由 NoteSpace 桌面端明确共享的工作区。

## 当前能力

- 按工作区和目录浏览 Markdown
- 搜索电脑上已经保存的正文
- 查看收藏与最近阅读位置
- 按工作区保存离线副本，断网后继续阅读和搜索
- 重新连接后自动刷新离线副本

> 手机端不会修改、删除或上传电脑里的文件。

[链接导航示例](./设计/移动端阅读设计.md)

## 表格示例

| 功能 | 当前状态 |
| --- | --- |
| Markdown 阅读 | 支持 |
| 离线工作区 | 支持 |
| 正文编辑 | 不提供 |
`,
      },
      "demo-design": {
        id: "demo-design",
        workspaceId: "demo-workspace",
        workspaceName: "产品笔记",
        title: "移动端阅读设计",
        relativePath: "设计/移动端阅读设计.md",
        markdown: `# 移动端阅读设计

手机端采用逐层目录和沉浸阅读，不照搬桌面端的永久文件树。

## 导航

底部保留浏览、搜索、收藏和最近四个稳定入口。

## 图表示例

\`\`\`mermaid
flowchart LR
  PC[桌面端] --> LAN[局域网]
  LAN --> APP[移动 App]
\`\`\`
`,
      },
      "demo-security": {
        id: "demo-security",
        workspaceId: "demo-workspace",
        workspaceName: "产品笔记",
        title: "局域网访问边界",
        relativePath: "设计/局域网访问边界.md",
        markdown:
          "# 局域网访问边界\n\n桌面端默认关闭共享，只暴露用户明确选择的工作区，并使用不透明文档标识。",
      },
      "demo-reading": {
        id: "demo-reading",
        workspaceId: "reading-workspace",
        workspaceName: "阅读摘录",
        title: "本周阅读",
        relativePath: "本周阅读.md",
        markdown: "# 本周阅读\n\n这里是另一个共享工作区中的演示文档。",
      },
    },
    favorites: [
      {
        id: "favorite-design",
        documentId: "demo-design",
        title: "移动端阅读设计",
        relativePath: "设计/移动端阅读设计.md",
        workspaceName: "产品笔记",
        available: true,
      },
      {
        id: "favorite-missing",
        documentId: "missing-document",
        title: "已停止共享的文档",
        relativePath: "旧笔记.md",
        workspaceName: "旧工作区",
        available: false,
      },
    ],
  });
}
