# Repository Agent Rules

这些规则用于人类和 AI 协作者。目标是让上下文压缩或多人并行后，仍能继续实现同一个简单、可运行的本地 Markdown 编辑器。

## 开始前阅读

按顺序完整阅读：

1. `AGENTS.md`
2. `docs/PROJECT_STATE.md`
3. `docs/DESIGN.md`
4. `docs/REQUIREMENTS.md`
5. 当前工作涉及的 accepted ADR；其中 `ADR-0005` 是当前精简边界
6. 只有在需要交互细节时才读取 `docs/design/*`；baseline 0.1 的复杂基础设施描述属于历史参考，和当前文档冲突时以 `ADR-0005` 与 baseline 0.2 为准

聊天记录不是项目状态。影响后续执行的决定、限制、验证结果和下一步必须写入 `PROJECT_STATE.md`、当前设计文档或 ADR。

如果仓库存在 `.codegraph/`，理解代码时先用 CodeGraph；否则先用 `rg` / `rg --files`。

## 产品与技术边界

- 这是普通的单用户本地文本编辑器，不是多租户服务或高安全文件网关。
- 应用运行时只使用 React、TypeScript、CodeMirror 6、Tauri 2 和 Rust；Node 用于构建、测试与轻量检查。不要引入 Ruby。
- Markdown 文件是唯一持久化真相；渲染、Outline、索引和预览都是可重建投影。
- `DocumentSession`、`Tab` 和 `HistoryEntry` 是不同概念：正文可共享，浏览历史与阅读位置按 Tab 隔离。
- 只给当前实际实现的 Tauri 命令定义类型。禁止恢复预冻结的 37 命令、巨型生成 schema、通用 feature flag 框架或可信宿主实验。
- 不新增服务端、账户、遥测或网络上传。任何网络能力都必须由用户提出并单独决策。

## 仅保留三项实用护栏

1. **Base64 防卡死**：大段 `data:image/...;base64,` 粘贴必须在 CodeMirror dispatch 前拒绝；文件先由 Rust 固定缓冲预检，命中病态 data URI/长行时不得把正文送入 JS。
2. **截图落盘**：图片先写入文档相邻 `assets/`，成功后前端才插入相对链接。未保存文档先 Save As；Undo 只撤销链接，不删除图片。
3. **原子保存**：同目录临时文件写入、flush 后 rename；失败保留旧文件。最多先做简单 mtime 外部修改提示。

不要把以上护栏扩展成 quarantine、HMAC/nonce、repair token、资产 journal、通用崩溃恢复引擎或巨型 IPC 压测，除非新的真实需求和 ADR 明确要求。

## 实现方式

- 优先完成可运行的纵向切片：界面入口 → 状态模型 → Tauri 命令 → 磁盘结果 → 测试。
- 前端功能按 `src/features/<domain>/` 放置；共享应用状态位于 `src/app/`；小型 IPC adapter 位于 `src/infrastructure/tauri/`。
- Rust 命令保持薄；文件预检、保存、资产写入等逻辑放在可单测模块中。
- 源码优先编辑器应保持 IME、选择、Undo/Redo 和 Markdown round-trip；装饰层不能改写正文。
- 内部 Markdown 链接统一进入应用导航逻辑，不使用 `window.location`。普通点击原地跳转，修饰键/中键可开新 Tab。
- Mermaid 和图片查看器只消费渲染结果，不修改正文；失败时显示源码或普通图片。
- 依赖应当由当前功能证明必要。不要为可能的未来扩展提前建设框架。

## 修改与协作

- 先检查工作树，保留用户和其他代理的无关修改。
- 使用 `apply_patch` 编辑文件；不要做无关格式化或依赖升级。
- 多日、跨模块或需要他人接手的工作才创建 `docs/tasks/<TASK-ID>.md`。小而完整的改动无需为流程制造文档。
- 并行任务应声明独占路径；根清单、lockfile、全局配置和 `PROJECT_STATE.md` 由集成者合并。
- Accepted ADR 不改写；用新 ADR 取代。旧提交与历史任务不代表当前需求。
- 永远不要读取后提交真实用户文档、剪贴板内容、个人绝对路径、密钥或大型 Base64 夹具。测试数据在临时目录运行时生成。

## 风险相称的验证

每次交付至少运行受影响层的格式、类型、单测和构建；不要为了仪式运行与改动无关的攻击、取消、陈旧 revision 或宿主人工门禁。

- 编辑器：覆盖 CJK composition、Undo/Redo、选择和 source round-trip。
- 导航：覆盖同一文档共享正文、每 Tab 独立历史与位置。
- 文件：覆盖预检分类、普通大文档和原子保存故障。
- 资产：覆盖写入成功/失败与“成功后才插链接”。
- Mermaid：覆盖超时/失败回退与查看器缩放交互。

标准本地门禁为 `pnpm verify`。Hosted CI 在存在远程仓库和发布需要时再启用，不阻塞本地产品实现。

## 交付状态

完成或上下文即将压缩时，更新 `docs/PROJECT_STATE.md`：说明当前可运行能力、未完成部分、准确验证命令和唯一下一步。不要把“设计过”“曾有实验代码”写成当前已实现能力。
