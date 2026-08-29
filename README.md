# Markdown Workspace

一个本地优先的 Markdown 桌面编辑器：像 Typora 一样在单画布中编辑，像浏览器一样使用 Tab、前进和后退浏览本地文档。

## 第一版目标

- 工作区文件树、Outline 和快速打开。
- CodeMirror 6 source-first 单画布编辑，重视中文输入、表格和原文 round-trip。
- 本地 Markdown 链接原地跳转，也可在新 Tab 打开；每 Tab 独立历史和阅读位置。
- 剪贴板截图自动写入相邻 `assets/`，再插入相对链接。
- Mermaid 与大图进入可缩放、平移、Fit 的查看器。
- 约 10 MiB 普通多行文档 source-only 编辑；大型 Base64 data-image 在进入 WebView 前阻止。

产品是普通单用户文本编辑器，不包含账户、服务端、遥测、HMAC/nonce、隔离区或复杂恢复系统。

## 技术栈

- 桌面：Tauri 2 + Rust
- 前端：React 19 + TypeScript + Vite
- 编辑器：CodeMirror 6 + Lezer
- 工具：Node 24 + pnpm 10；不使用 Ruby

## 本地开发

macOS 需要 Xcode Command Line Tools 和 Rust toolchain。

```bash
pnpm install --frozen-lockfile
pnpm desktop:dev
```

完整本地门禁：

```bash
pnpm verify
```

## 文档入口

- [当前项目状态](docs/PROJECT_STATE.md)
- [完整产品与技术设计](docs/DESIGN.md)
- [需求与验收 ID](docs/REQUIREMENTS.md)
- [多代理实施计划](docs/IMPLEMENTATION_PLAN.md)
- [精简本地编辑器边界](docs/decisions/0005-lean-local-editor-boundary.md)
- [Paper & Ink 主界面原型](docs/prototypes/markdown-workspace-main-v1.png)
- [代理协作规则](AGENTS.md)

历史 `docs/design/*` 和早期 ADR 保存了交互探索；若与当前 baseline 0.2 冲突，以 `ADR-0005`、`DESIGN.md` 和 `REQUIREMENTS.md` 为准。

## 上下文恢复

新代理或压缩后的上下文按顺序读取：`AGENTS.md` → `PROJECT_STATE.md` → `DESIGN.md` → `REQUIREMENTS.md` → 当前任务涉及的 ADR/代码。不要根据旧提交或历史 task note 恢复已经退役的基础设施。
