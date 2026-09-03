# NoteSpace（笔记空间）

一个本地优先的 Markdown/文本桌面编辑器：像 Typora 一样可视化编辑，使用 Tab、前进和后退浏览本地文档，也可分屏并排编辑。

源码仓库：[Ysclmml/notespace](https://github.com/Ysclmml/notespace)。

## 第一版目标

- 工作区文件树、Outline 和快速打开。
- Milkdown/ProseMirror 默认可视编辑，CodeMirror 6 显式源码和代码/文本编辑，重视中文输入、表格和原文 round-trip。
- 文件树单击临时预览（斜体标签），双击或编辑固定；打开文件跟随当前活动分屏。
- 标签右键向右分屏会移动原 Tab，拖动标签到其他分屏，拖动分隔线调整宽度；每 Tab 独立视图，同文件共享正文。代码“在右侧打开”复用编辑分组，不再额外占一个辅助栏。
- `Cmd/Ctrl+F` 查找当前页面；工作区根右键可勾选递归显示隐藏文件和文件夹。
- 设置中选择启动时恢复上次浏览（默认）或打开空白窗口；只记录文件路径、标签、分屏和阅读位置，正文仍从原文件读取，未保存草稿不持久化。
- 感知外部新增、修改和删除：文件树自动刷新，未编辑文件自动重载；有本地修改或文件被删除时保留正文并提示，暂停自动保存，避免无意覆盖或重建。
- 本地 Markdown 链接：未固定标签原位跳转，固定/编辑后的标签新开预览；前进/后退跨标签与分屏恢复，每个标签保留独立阅读位置。
- 剪贴板截图自动写入相邻 `assets/`，再插入相对链接。
- Mermaid、文内大图与图片链接进入可缩放、平移、Fit 的查看器，图片链接不要求行号。
- HTTP/HTTPS 网页链接可从正文、链接悬浮卡片或源码点击，在系统默认浏览器打开；不在应用内抓取网页。
- 约 10 MiB 普通多行文档 source-only 编辑；大型 Base64 data-image 在进入 WebView 前阻止。

产品是普通单用户文本编辑器，不包含账户、服务端、遥测、HMAC/nonce、隔离区或复杂恢复系统。

## 技术栈

- 桌面：Tauri 2 + Rust
- 前端：React 19 + TypeScript + Vite
- 编辑器：Milkdown/ProseMirror + CodeMirror 6 + Lezer
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

生成可直接双击的 macOS debug 应用：

```bash
pnpm exec tauri build --debug --bundles app
open "src-tauri/target/debug/bundle/macos/NoteSpace.app"
```

产物位于 `src-tauri/target/debug/bundle/macos/NoteSpace.app`；内部原生可执行文件位于 `Contents/MacOS/notespace`。发布包位于 `src-tauri/target/debug/bundle/dmg/NoteSpace_0.1.0_aarch64.dmg`。

应用的公开名称已经改为英文 `NoteSpace`、中文“笔记空间”。为让旧版本直接升级并继续读取原有设置，bundle identifier 与既有本地存储键保持不变。

源码和提交历史通过 Git 管理；依赖、构建产物、本机数据与签名材料不入库。推送 `main` 会触发现有 GitHub Actions 质量门禁，通过后生成保留 7 天的 Debug ZIP；它不是正式 Release。面向用户的安装包应作为 GitHub Release 附件另行发布，当前尚未配置 Homebrew tap 或 Apple Developer ID 签名/公证发布流程。

文档保存在原路径或“另存为”选择的目录，截图资源在文档旁的 `assets/`。macOS 应用设置、最近项和浏览元数据存于 `~/Library/WebKit/app.markdownworkspace.desktop/WebsiteData/Default/` 下的 WebKit 本地存储，不上传，也不写入仓库。

## 文档入口

- [当前项目状态](docs/PROJECT_STATE.md)
- [完整产品与技术设计](docs/DESIGN.md)
- [需求与验收 ID](docs/REQUIREMENTS.md)
- [多代理实施计划](docs/IMPLEMENTATION_PLAN.md)
- [精简本地编辑器边界](docs/decisions/0005-lean-local-editor-boundary.md)
- [Paper & Ink 主界面原型](docs/prototypes/markdown-workspace-main-v1.svg)
- [代理协作规则](AGENTS.md)

历史 `docs/design/*` 和早期 ADR 保存了交互探索；若与当前 baseline 1.1 冲突，以 `ADR-0005`～`ADR-0014`、`DESIGN.md` 和 `REQUIREMENTS.md` 为准。

## 上下文恢复

新代理或压缩后的上下文按顺序读取：`AGENTS.md` → `PROJECT_STATE.md` → `DESIGN.md` → `REQUIREMENTS.md` → 当前任务涉及的 ADR/代码。不要根据旧提交或历史 task note 恢复已经退役的基础设施。
