# Markdown Workspace 需求基线

状态：Approved baseline 0.2

日期：2026-08-30

本文件保存稳定需求 ID，供实现、测试和上下文压缩后继续执行。优先级：MVP、P1、Later。状态：Active、Deferred、Done。

当前实现快照：工作区、文件树、基础 Tab/back-forward、单画布编辑、本地打开/原子保存、大 Base64 护栏和截图落盘已有自动化纵向切片。`NAV-HISTORY-001` 的精确 view-state 恢复、Mermaid/图片沉浸查看器、`FILE-EXTERNAL-001` 和真实 Tauri 人工验收仍未完成；准确进度以 `PROJECT_STATE.md` 为准。

## 1. MVP 产品需求

| ID                    | 需求                                   | 验收摘要                                         |
| --------------------- | -------------------------------------- | ------------------------------------------------ |
| `DATA-SOURCE-001`     | Markdown 原文是正文唯一真相            | 渲染/Outline 不参与保存；未知语法保留            |
| `DATA-ROUNDTRIP-001`  | 未编辑文档保存零差异                   | fixture 字节一致；不强制格式化                   |
| `WORKSPACE-OPEN-001`  | 用户可选择本地目录作为工作区           | 原生 chooser；侧栏展示目录名和 Markdown 文件     |
| `WORKSPACE-TREE-001`  | 文件树支持展开目录和打开文档           | Unicode/空格路径可用；忽略常见隐藏/构建目录      |
| `DOC-OPEN-001`        | 文件树和内部链接可打开 Markdown        | 进入已有 session 或创建新 session                |
| `DOC-SAVE-001`        | `⌘S` 保存当前文档                      | 成功清 dirty；失败保留 dirty 和原文件            |
| `EDIT-LIVE-001`       | 源码与渲染位于同一画布                 | 光标附近显示源码，非活动块可读                   |
| `EDIT-IME-001`        | 中文 IME composition 稳定              | composition 中不重建相关装饰，不重复提交         |
| `EDIT-UNDO-001`       | Undo/Redo 只撤销正文编辑               | 与浏览 back/forward 相互独立                     |
| `EDIT-TABLE-001`      | GFM 表格可读且随时回到精确源码         | 第一版不要求网格化编辑                           |
| `NAV-TAB-001`         | 支持多个浏览器式 Tab                   | 激活、关闭、dirty 标记、同文件 session 复用      |
| `NAV-HISTORY-001`     | 每 Tab 独立后退/前进                   | 恢复文档、anchor、滚动和选择；无全文副本         |
| `NAV-LINK-001`        | 内部 Markdown 链接默认原地跳转         | `⌘`/中键新后台 Tab，`⌘⇧` 新前台 Tab              |
| `NAV-ANCHOR-001`      | 支持 heading anchor                    | 重复标题 slug 行为固定并有测试                   |
| `OUTLINE-001`         | 当前文档可显示标题大纲                 | 点击滚动并聚焦标题；source-only 可关闭           |
| `ASSET-PASTE-001`     | 粘贴截图自动落盘并插入链接             | 写入成功后才修改正文；失败正文不变               |
| `ASSET-BASE64-001`    | 产品不主动生成内嵌 Base64 图片         | 保存结果使用相对文件 URI                         |
| `DIAGRAM-MERMAID-001` | Mermaid 可文内预览                     | 失败显示源码；渲染不修改正文                     |
| `DIAGRAM-VIEWER-001`  | Mermaid/大图可放大、平移、Fit          | Esc 返回原块，SVG 保持矢量                       |
| `FILE-PREFLIGHT-001`  | Rust 在正文进入 WebView 前轻量预检     | 固定缓冲统计 size/UTF-8/最长行/data-image        |
| `FILE-LARGE-001`      | 约 10 MiB 普通多行 Markdown 可编辑     | source-only 模式，不运行昂贵投影                 |
| `SAFE-DATAURI-001`    | 大型 data-image/病态长行不得卡死编辑器 | 文件正文不返回 JS；大粘贴不创建 transaction      |
| `FILE-SAVE-001`       | 保存采用同目录临时文件原子替换         | 故障时旧文件完整；成功时新文件完整               |
| `FILE-EXTERNAL-001`   | 简单提示磁盘外部修改                   | mtime 不符时可重新加载、覆盖或取消               |
| `OPS-OFFLINE-001`     | 默认无网络、无账户、无遥测             | 没有文档上传路径                                 |
| `OPS-BUILD-001`       | macOS 可运行 Tauri debug app           | `pnpm verify` 和手动主链路通过                   |
| `OPS-CONTEXT-001`     | 新代理不依赖聊天恢复项目               | 先读 AGENTS、PROJECT_STATE、DESIGN、REQUIREMENTS |

## 2. 实用护栏的精确行为

### `SAFE-DATAURI-001`

- 前端只在粘贴文本大于 1 MiB 且含 `data:image/...;base64,` 时拒绝。
- 拒绝发生在 CodeMirror dispatch 之前；正文、选择和 Undo 栈不变。
- Rust 使用 64 KiB 级固定缓冲扫描文件，不把 blocked 正文放进返回对象。
- 不要求 Base64 解码、自动提取、修复 token、隔离、备份或恶意混淆检测。

### `ASSET-PASTE-001`

- 支持系统剪贴板图片；Rust 直接读取像素并统一编码为 PNG。
- 已保存文档写入相邻 `assets/`；未保存文档先 Save As。
- 文件名避免覆盖已有资源，返回 URI 使用 `/` 并对空格等做 Markdown/URL 兼容编码。
- Undo 仅移除 Markdown 链接，图片保留。

### `FILE-SAVE-001`

- 临时文件必须和目标位于同一目录，以便 rename 保持原子语义。
- 写入/flush 失败不触碰目标；rename 成功后当前返回 path/bytesWritten，mtime 随外部修改提示后续增加。
- 实现只清理当前调用创建的精确临时文件，不递归清理目录。
- 第一版不要求持久化 save journal、prepare/ack 协议或崩溃恢复中心。

## 3. 导航状态不变量

| ID                    | 不变量                                              |
| --------------------- | --------------------------------------------------- |
| `NAV-MODEL-001`       | `DocumentSession != Tab != HistoryEntry`            |
| `NAV-SESSION-001`     | 同一路径一个可编辑 session；多个 Tab 共享正文/dirty |
| `NAV-VIEW-001`        | 每 Tab 的滚动、选择、back 和 forward 独立           |
| `NAV-DISPOSITION-001` | 点击修饰键只决定 same-tab/new-tab，不改变资源解析   |
| `NAV-NO-COPY-001`     | history 不保存完整 Markdown                         |

## 4. 当前 Tauri 接口要求

当前只存在下列 5 个命令：

```text
pick_workspace()
list_workspace(rootPath)
open_document(path)
save_document(path, content)
save_clipboard_image(documentPath)
```

| ID                  | 接口要求                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `IPC-WORKSPACE-001` | chooser/list 返回当前功能需要的简洁 serde 结构                                                            |
| `IPC-DOCUMENT-001`  | open 当前返回 editable/blocked union；editable 携带 normal/sourceOnly，blocked 无正文                     |
| `IPC-SAVE-001`      | save 当前返回 path/bytesWritten 或可读错误；mtime 提示未实现                                              |
| `IPC-ASSET-001`     | Rust 直接读取系统剪贴板；命令只接收 documentPath，返回图片路径/相对 URI/尺寸，不传 bytes 或 Base64 字符串 |
| `IPC-LEAN-001`      | 不预生成未来命令、错误码全集或巨型 schema；新增功能时再加类型                                             |

## 5. 性能与体验验收

| ID                 | 目标                                               |
| ------------------ | -------------------------------------------------- |
| `PERF-TYPE-001`    | 普通输入和 IME 无明显掉帧或光标跳动                |
| `PERF-OPEN-001`    | 典型 250 KiB 文档在开发机 300 ms 级进入可编辑状态  |
| `PERF-LARGE-001`   | 10 MiB 普通多行 fixture 打开、编辑、保存不冻结窗口 |
| `PERF-TREE-001`    | 大目录首屏可分批出现，不等待完整深度扫描才显示     |
| `PERF-DIAGRAM-001` | Mermaid 离屏不主动批量渲染；单块失败不拖垮页面     |

性能数字是初始工程目标，不是发布 SLA；改变实现前先记录测量。

## 6. P1 / Later

| ID                     | 优先级 | 状态     | 内容                                   |
| ---------------------- | ------ | -------- | -------------------------------------- |
| `SEARCH-WORKSPACE-001` | P1     | Deferred | 工作区全文搜索与 Quick Open 排序       |
| `NAV-SPLIT-001`        | P1     | Deferred | 最多两个左右 Pane                      |
| `NAV-RECENT-001`       | P1     | Deferred | 最近关闭 Tab 与轻量会话恢复            |
| `LINK-BACKREF-001`     | P1     | Deferred | 反向链接、断链和重命名修复             |
| `EDIT-TABLE-GRID-001`  | P1     | Deferred | 结构化表格编辑浮层                     |
| `EDIT-MATH-001`        | P1     | Deferred | 数学渲染                               |
| `EXPORT-001`           | P1     | Deferred | PDF/HTML/SVG/PNG 导出                  |
| `GIT-001`              | Later  | Deferred | diff、历史与冲突工具                   |
| `GRAPH-001`            | Later  | Deferred | 文档图谱                               |
| `AI-001`               | Later  | Deferred | 工作区检索、引用与问答；需单独隐私决策 |
| `PLUGIN-001`           | Later  | Deferred | 真实扩展需求出现后再定义插件 API       |

以下旧需求在 baseline 0.2 不作为 MVP 门禁：资产 staging/journal/GC、完整崩溃恢复、窗口布局恢复、复杂 save-as 状态机、HMAC/nonce host evidence、193 MiB IPC transport、14 项 typed flags、Hosted CI 证据。

## 7. MVP 验收场景

| ID               | 场景                                                   |
| ---------------- | ------------------------------------------------------ |
| `AC-EDIT-001`    | 打开中文 Markdown，编辑标题/表格并保存；重开内容一致   |
| `AC-NAV-001`     | A 点击 B，再后退/前进；两侧滚动位置正确                |
| `AC-TAB-001`     | 同文档两个 Tab 共享编辑结果但历史独立                  |
| `AC-ASSET-001`   | 粘贴截图后文件存在且链接相对；模拟失败时正文不变       |
| `AC-BASE64-001`  | 10 MiB data-image 粘贴/文件均不进入 editor transaction |
| `AC-LARGE-001`   | 10 MiB 普通多行文档以 source-only 编辑并保存           |
| `AC-DIAGRAM-001` | Mermaid 进入查看器，缩放/平移/Fit/Esc 正常             |
| `AC-OFFLINE-001` | 断网状态下核心工作流完整可用                           |
