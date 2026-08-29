# ADR-0004：病态输入保护

状态：Accepted  
日期：2026-08-29

## 决策

不开发通用巨型文件编辑器。通过以下四层低成本机制防止异常内容拖死应用：

1. 粘贴事件与编辑事务双重长度闸门。
2. Rust 打开前分块预检。
3. 大文本模式与病态内容安全页面。
4. 恢复时重新预检，并阻止重复崩溃文件自动打开。

## 默认策略

按顺序先命中先处理：

1. 二进制、无法无损支持的编码或大于 32 MiB：Unsupported。
2. data image 估算大于 512 KiB 或单行大于 1 MiB：SafetyBlocked。
3. 文件不超过 8 MiB 且最大行不超过 256 KiB：normal。
4. 其余不超过 32 MiB 的文本：largeText。

阈值是可测试配置，不是对外格式保证。

## 背景与原因

真实语料规模很小，核心需求是普通文档体验。十几 MiB 单行 Base64 属于极低频误操作，只需保证应用可自救。

## 明确不做

- 自研 mmap、rope 或分块编辑器。
- Base64 专用可视化编辑。
- 将病态正文传给 WebView 后再尝试补救。

## 备选与被拒绝方案

- 完全不防护：一次误粘贴即可让编辑器与修复 UI 同时失去响应。
- 只在 CodeMirror 内检查：正文已经跨 IPC/构造 JS String，保护发生得太晚。
- 自研 mmap/rope/分块巨型编辑器：投入与真实使用频率不匹配，且不解决图片解码和恶意 SVG。
- 一律拒绝 8 MiB 以上文件：实现最简单，但无必要地牺牲普通 10 MiB 多行文本。

## 后果与代价

- 打开与粘贴增加一次有界扫描和策略分支。
- 8–32 MiB 普通文本只得到 largeText 功能集。
- SafetyBlocked 用户必须在安全页修复或使用外部工具，不能强制塞入主 EditorView。
- 阈值边界、修复备份和崩溃隔离需要专门 fixture 与故障注入。

## 迁移与回滚

- 阈值由版本化 PerformancePolicy 管理；调整必须有基准、边界测试和 ADR，不能由前端局部覆盖。
- 安全闸门在生产版 fail closed，不允许通过普通 feature flag 回滚为“先打开再提示”。
- renderer/live preview 可以降级或关闭；纯文本保存与恢复必须保留。
- 安全页修复失败时保留原文件、备份和 staging，不需要正文格式迁移。

## 安全与数据影响

- SafetyBlocked response 不包含正文或 Base64；修复在 Rust 有界流式执行。
- repairToken 绑定 DocumentId、DiskRevision、扫描报告、capability 和有效期。
- 日志只记录大小/行长 bucket 和错误码，不记录可疑片段。
- 修复必须先备份，再 revision check 和原子替换。

## 受影响契约

- FILE-PREFLIGHT-001、PERF-LARGE-001、SAFE-DATAURI-001。
- FILE-INV-001、DOC-INV-003、ARCH-INV-007。
- DocumentOpenOutcome、PerformancePolicy 和 document_repair_v1。

## 验证

- SAFE-001、SAFE-003、PERF-010。
- AC-SAFE-001、AC-SAFE-002、AC-SAFE-004。
- CONTRACT-011、REC-002。
