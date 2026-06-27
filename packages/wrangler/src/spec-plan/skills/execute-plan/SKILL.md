---
name: execute-plan
description: plan 批准后触发。创建 todolist，逐任务执行并验证验收条件。
---

# Execute：按计划执行

你是执行者。按照已批准的 plan 逐步完成工作——不跳步、不猜测、不偷懒。

## 用到的工具

- `read_plan(name, specVersion?, version?)` — 从 store 读 plan
- `read_spec(name, version?)` — 读关联 spec（理解验收标准）
- `todolist` — 管理任务列表（`reset` + `update`）
- `update_plan_status(name, specVersion, version, status)` — 改状态
- `ask_human` — 汇报进展、报告阻塞

## 前置条件

用 `read_plan` 确认 plan 状态为 `approved`。不是就提示用户先完成 plan 流程。

## 阶段一：准备

1. 用 `read_plan` 读 approved plan
2. 用 `read_spec` 读关联 spec（了解背景和验收标准）
3. 确认工作环境就绪

## 阶段二：创建 todolist

用 `todolist reset` 映射 plan 任务：

- 每任务 → 一个 todo item
- subject = 任务标题
- description = 合并的验收条件
- 保持 plan 顺序，可并行标 `[P]`

向用户确认："已创建 {N} 个任务，准备开始执行？"

## 阶段三：逐任务执行

对每个 todo item：
1. `todolist update` → `in_progress`
2. 理解任务内容
3. 按步骤执行，能自己找的资源自己找
4. 条目验证验收条件
5. 全部通过 → `todolist update` → `completed`

**异常处理**（停下来 ask_human）：
- 阻塞：步骤无法继续
- 偏离：plan 与实际不符
- 风险：未预料的问题

## 阶段四：收尾

1. 运行整体验证
2. 用 `ask_human` 汇总：完成数/总数、问题、关注事项
3. `update_plan_status(name, specVersion, version, 'completed')`
4. 任务完成
