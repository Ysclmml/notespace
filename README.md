# Markdown Workspace

一个面向本地 Markdown 文件的桌面编辑与浏览工作台。项目暂名 **Markdown Workspace**。

当前仓库已进入 Phase 0 实现。第一目标不是复刻全部 Typora 功能，而是在保留单画面编辑体验的基础上，解决以下真实工作流：

- Markdown 原文是唯一真相，未编辑内容应保持零差异。
- 截图零配置落盘并插入相对链接，不写入 Base64。
- 本地文档像网页一样支持原地跳转、独立 Tab 历史、前进、后退和未来分栏。
- Mermaid、图片等视觉内容可放大、平移；导出作为 P1 增强。
- 普通文档保持流畅；异常长行或大 data URI 不得拖死应用。
- 架构允许以后加入搜索、反向链接、知识图谱、Git、AI 等资源页面。

## 当前假设

- macOS 优先完成和验证，Windows、Linux 保持架构兼容。
- 桌面容器使用 Tauri 2，前端使用 React、TypeScript、Vite。
- 编辑器使用 CodeMirror 6 和 Lezer，采用 source-first 的 WYSIWYM 路线。
- Rust 本地核心负责文件、资产、预检、原子保存、恢复和权限边界。
- 不需要服务端；普通 Markdown 文件及其 assets 目录是用户数据的事实来源。

## 文档入口

- [总体设计](docs/DESIGN.md)
- [规范化需求与追踪矩阵](docs/REQUIREMENTS.md)
- [当前项目状态与交接](docs/PROJECT_STATE.md)
- [产品与交互规格](docs/design/01-product-ux.md)
- [系统架构](docs/design/02-system-architecture.md)
- [领域模型与接口契约](docs/design/03-domain-model-and-contracts.md)
- [编辑器与渲染](docs/design/04-editor-rendering.md)
- [导航、Tab 与链接](docs/design/05-navigation-tabs.md)
- [文件、资产与恢复](docs/design/06-file-assets-recovery.md)
- [性能与安全](docs/design/07-performance-security.md)
- [扩展机制](docs/design/08-extension-model.md)
- [测试与可观测性](docs/design/09-testing-observability.md)
- [多代理实施计划](docs/IMPLEMENTATION_PLAN.md)
- [实施任务交接模板](docs/tasks/TEMPLATE.md)
- [代理协作规则](AGENTS.md)
- [架构决策记录](docs/decisions/)
- [设计文档静态校验](scripts/validate_design_docs.rb)

## 设计优先级

真实语料只读统计显示：79 篇 Markdown 共约 1.02 MiB，最大约 243 KiB；表格覆盖约 96% 文件，跨文档 Markdown 链接约 1,106 条。由此确定第一阶段优先级：

1. 表格、中文输入、保存零差异和基础编辑手感。
2. 本地链接、Tab、每 Tab 独立前进后退及精确位置恢复。
3. 图片粘贴落盘、Mermaid 放大。
4. 低成本的大文本和病态输入保护。

## 状态

设计文档版本：Approved design baseline 0.1  
设计日期：2026-08-29  
实现状态：Phase 0 进行中；Tauri/React/Rust 桌面壳已建立，产品能力尚未接入

## 本地开发

基线工具链是 Node 24.14、pnpm 10.32 和 Rust 1.98；macOS desktop 开发需要 Xcode Command Line Tools。

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev
```

运行完整的本地基础门禁与 debug desktop build：

```bash
pnpm verify
```

当前空状态中的打开、Tab、历史和编辑入口会明确保持禁用；它们分别等待 Phase 0 契约冻结以及 Phase 1–4 的实现任务，不代表构建故障。

## AI 上下文恢复

任何新代理或上下文压缩后的代理都必须按以下顺序恢复：

1. 阅读根目录 [AGENTS.md](AGENTS.md)。
2. 阅读 [PROJECT_STATE.md](docs/PROJECT_STATE.md) 获取当前事实。
3. 阅读 [DESIGN.md](docs/DESIGN.md) 和 [REQUIREMENTS.md](docs/REQUIREMENTS.md)。
4. 只加载当前任务涉及的领域设计和 ADR。
5. 从 [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) 领取一个未完成任务。

聊天记录不是项目事实来源。任何影响后续执行的决定都必须落入仓库文档。
