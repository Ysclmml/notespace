# ADR-0001：应用技术栈

状态：Accepted  
日期：2026-08-29

## 决策

采用 Tauri 2 作为桌面容器，React、TypeScript、Vite 构建前端，CodeMirror 6 与 Lezer 构建编辑器，Rust 构建本地核心。

## 背景与原因

- 编辑器和 Mermaid 等成熟能力集中在 Web 生态。
- Rust 适合文件预检、流式修复、原子保存和权限边界。
- Tauri 复用系统 WebView，适合本地优先、较小包体的桌面应用。
- 前端与宿主通过窄接口隔离，必要时保留迁移到 Electron 的可能。

## 官方能力核验（2026-08-29）

- [Tauri 2 架构](https://v2.tauri.app/concept/architecture/) 明确采用 Rust 宿主 + HTML WebView，并通过消息传递连接前端与本地能力，与本 ADR 的双边界结构一致。
- [Tauri permissions](https://v2.tauri.app/security/permissions/) 和 [capability reference](https://v2.tauri.app/reference/acl/capability/) 支持按命令、窗口/WebView 与 scope 授权；本项目在此之上再使用领域 grant/epoch，两层都必须通过。
- [Tauri clipboard plugin](https://v2.tauri.app/plugin/clipboard/) 在桌面端提供图片读取且默认不开权限。Phase 0 可用其 Rust API 作平台 adapter，但禁止前端 `readImage()` 路径；图片字节不得穿过 guest JS/IPC。
- 官方文档只证明能力可行，不锁定依赖版本。`P0-BOOT-01` / `P0-CONTRACT-01` 必须重新核验当时文档、锁定版本并记录许可证。

## 后果与代价

- WKWebView、WebView2、WebKitGTK 存在行为差异。
- 中文 IME、contenteditable、选区和字体必须分平台验证。
- 团队需要同时维护 TypeScript 和 Rust。

## 备选与被拒绝方案

- 纯浏览器：文件权限、原子保存和系统集成不足。
- 完全原生 AppKit：跨平台和编辑内核成本过高。
- Electron 首选：开发更快但包体与运行基线较高；保留为失败回退。
- Qt/Python：仍需 Web 编辑器且部署、许可或性能收益有限。

## 迁移与回滚

- Phase 0 必须用 release 构建验证 Tauri IPC 大正文传输、中文 IME、系统菜单、文件对话框和原子保存。
- Tauri 细节只允许出现在 src-tauri 和 src/infrastructure/tauri；领域、React feature 和 CodeMirror adapter 依赖 port，不能直接 invoke。
- 若 Phase 0 证明系统 WebView 在目标平台存在不可接受且无法隔离的问题，可新增 ADR 切换 Electron；ResourceRouter、DocumentSession、命令 schema 和测试 fixture 保持，替换宿主 adapter。
- 已产生的 Markdown、资产和恢复导出必须仍可读；回滚不能要求用户迁移正文格式。

## 安全与数据影响

- Tauri capability、CSP 和窄 IPC 是安全边界；不提供通用文件、网络或 shell bridge。
- 正文和图片默认只在本机处理，不因技术栈选择上传。
- 系统 WebView 差异可能影响 sanitizer、IME 和渲染，发布前逐平台验证。

## 受影响契约

- ARCH-INV-001、ARCH-INV-006、SAFE-IPC-001。
- docs/design/02-system-architecture.md 的进程/目录边界。
- docs/design/03-domain-model-and-contracts.md 的 IPC envelope 和命令白名单。

## 验证

- BUILD-001、CI-001：干净环境构建、启动和产物。
- SEC-001：capability/IPC 白名单。
- IME-001：macOS 中文 composition。
- Phase 0 的 P0-SPIKE-01、P0-SPIKE-02 和 clean-machine smoke。
