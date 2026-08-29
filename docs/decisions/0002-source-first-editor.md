# ADR-0002：source-first 编辑器

状态：Accepted  
日期：2026-08-29

## 决策

CodeMirror EditorState.doc 中的 Markdown 文本是编辑期唯一真相。Lezer 语法树、HTML、目录、链接索引和视觉 Widget 均为派生缓存。

## 背景与原因

- 未编辑内容可保持字节级不变。
- 未知 Markdown 扩展不会因为富文本反序列化而丢失。
- CodeMirror 提供视口渲染、事务、增量解析和可替换 Widget。
- 适合对病态内容进行进入编辑器前的独立保护。

选型证据以官方文档为准：[CodeMirror system guide](https://codemirror.net/docs/guide/) 定义了 viewport/visible range 渲染和 decoration 机制；[Lezer system guide](https://lezer.codemirror.net/docs/guide/) 定义了节点复用的增量解析和错误恢复。这些能力支持该路线，但不代替 `P0-SPIKE-01` 的 IME、长行和块级 decoration 实测。

## 后果与代价

- Typora 式标记显隐需要自行实现。
- 富表格编辑比 ProseMirror 路线更困难。
- Widget、光标、选区和 IME 的交互需要大量回归测试。

## 备选与被拒绝方案

- ProseMirror、Tiptap 或 Milkdown 作为主数据模型：适合快速 WYSIWYG，但 Markdown 会经历解析和重新序列化。
- 双模型实时同步：容易产生文本与富文本状态分叉。

## 迁移与回滚

- P0 先交付 source-only CodeMirror，再逐类启用视口 decoration/Widget；任何 renderer 都可被 feature flag 关闭而不影响正文。
- 某类 live preview 若无法满足 IME、选择或 round-trip，只回滚该 renderer 到源码显示，不能切换正文真相。
- 将来若评估其他编辑内核，必须先证明 EditorState.doc 等价、零差异、未知语法和 transaction/undo 契约；不得以一次性富文本导入替代用户文件。

## 安全与数据影响

- 未识别和恶意语法按原文保留，不由富文本 serializer 丢弃或改写。
- Widget 输出仍是不可信派生内容，必须净化和隔离；它没有文件写入能力。
- 索引、AST、HTML 和渲染缓存可删除重建，不构成用户数据。

## 受影响契约

- DATA-SOURCE-001、DATA-ROUNDTRIP-001、DATA-UNKNOWN-001。
- EDIT-LIVE-001、EDIT-UNDO-001、EDIT-IME-001。
- docs/design/04-editor-rendering.md 的 transaction 与 BlockRenderer 边界。

## 验证

- RT-001、RT-002：零编辑与未知语法 round-trip。
- EDT-LIVE-001、EDT-UNDO-001、IME-001。
- TABLE-001、VIS-001：派生渲染失败回到精确源码。
