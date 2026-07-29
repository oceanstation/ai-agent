---
name: sdd-implement
description: 规约驱动开发第 4 阶段（implement）。按已批准的 tasks 清单逐条执行代码修改；使用 read_file / write_file / run_command 落地实现。仅在 tasks 阶段已被用户批准后启用。
---

# SDD · implement 阶段

## 前置条件
- 该 feature 的 `tasks` 已被用户显式批准。
- 使用本 skill 前必须先 `sdd_read_artifact(featureId)` 一次性拉回 specify + plan + tasks。
- 需要 workspace 处于可写模式（`WORKSPACE_WRITABLE=true`），否则 `write_file` 会失败。命令执行需要 `WORKSPACE_COMMAND_ENABLED=true` 且命令在白名单里。

## 目标
按 tasks 清单从上到下执行，将 plan 中的方案落成实际代码 / 配置 / 测试。

## 执行步骤
1. **加载前置**：`sdd_read_artifact({ featureId })`，把 specify / plan / tasks 全部拉进上下文。
2. **按序执行**：
   - 每条任务开始前先给用户一句话说明"这一步要做什么"。
   - 使用 `list_dir` / `read_file` 侦察，再用 `write_file` 修改；重要时可用 `run_command` 跑 lint/test。
   - 任务完成后勾掉清单（重写 tasks.md 的对应行为 `- [x]`）；这一步走 `sdd_write_artifact({ phase: 'tasks', ... })`。**这是刷新任务清单的唯一正当理由**。
3. **收尾产物**：所有任务勾完后，写一份简要的 implement.md：调用 `sdd_write_artifact({ featureId, phase: 'implement', content })`。产物内容包含：
   - 已完成任务与主要改动
   - 手工验证结果 / 自动化测试结果
   - 已知遗留问题与后续建议
4. **闭环**：implement 是终态，写完后**不需要**用户批准；工具返回的 spec_gate 块 `pendingApproval` 为 false，前端会显示"实施完成"。

## 规则
- 一次只做一条任务；不要合批多条任务后再向用户汇报
- 如果发现 plan 与实际实现冲突，先暂停实施并向用户说明冲突点；不得擅自偏离已批准的方案
- 破坏性操作（删文件、跑数据库迁移等）必须先向用户确认，即使命令在白名单里
- 测试失败时不要"随便改测试让它通过"，先分析原因

## implement.md 结构

```markdown
# <feature> · 实施记录

## 完成情况
- T1 ✅ <一句话摘要>
- T2 ✅ ...
- Tn ⚠️ 部分完成 / 遗留问题

## 关键改动
- `path/to/file.ts` — 简述改动

## 验证
- 单元测试：`pnpm test` 结果
- 手工验证：跑了什么、看到什么

## 遗留
- 明确列出未完成或存疑的点
```
