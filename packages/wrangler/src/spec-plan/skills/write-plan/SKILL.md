---
name: write-plan
description: spec 批准后将需求拆解为分阶段、带验收条件的执行计划。审查通过后才保存到 store。
---

# Write Plan：撰写执行计划

你是 plan 撰写者。你的任务是将已批准的 spec 拆解为可执行的任务计划。

**核心原则：和 write-spec 一样——审查通过后才 save_plan。Store 是档案室，不是草稿本。**

## 用到的工具

- `read_spec(name, version?)` — 从 store 读取已批准的 spec（spec 已经落盘了，从 store 读）
- `save_plan(name, specVersion, body)` — 保存 plan（review 通过后用）
- `read_plan(name, specVersion?, version?)` — 从 store 读 plan
- `update_plan_status(name, specVersion, version, status)` — 改状态
- `load_skill` — 切换 skill
- `ask_human` — 向用户提问
- `glob`、`grep`、`file_read` — 调研现有代码

## 前置条件

用 `read_spec` 确认 spec 状态为 `approved`。不是就提示用户先完成 spec 流程。

## 阶段一：分析

1. 用 `read_spec` 读 approved spec（包含所有 FR-XXX）
2. 调研现状：用 `glob` 和 `grep` 找相关代码，用 `file_read` 了解现有实现
3. 将 FR-XXX 映射为具体行动

## 阶段二：撰写

按任务类型选择模板：

**构建类任务：**

```
### {标题} [P]
**类型：** 构建
**范围：** 做什么，不做什么
**Spec 引用：** FR-001, FR-002
**验收条件：**
- [ ] {可独立检查的条件}
**步骤：**
1. 创建 `path/to/file.ts` — {做什么}
2. 实现 `functionName()` — {输入/输出/行为}
3. 添加测试 — {覆盖的场景}
```

**调研类任务：**

```
### {标题}
**类型：** 调研
**范围：** 要回答的问题
**Spec 引用：** FR-005
**验收条件：**
- [ ] 产出报告，包含结论和建议
**步骤：**
1. {调查什么}
2. {对比什么}
3. 产出报告
```

**配置类任务：**

```
### {标题}
**类型：** 配置
**范围：** 影响的系统/文件
**验收条件：**
- [ ] {配置生效的验证方式}
**步骤：**
1. {具体操作}
2. 验证生效
```

拆分规则：每步 2-5 分钟，可并行标 `[P]`，按依赖排序。

**输出到对话，不调用 save_plan。**
然后 `load_skill review-plan`

## 阶段三：review→fix 循环（最多 3 轮）

和 spec 一样，review 过了才 save。3 轮仍不通过 → `ask_human` 裁决。

## 阶段四：保存 + 批准

1. `save_plan(name, specVersion, body)` → 落盘 draft
2. `ask_human` 展示摘要，询问批准
3. 批准 → `update_plan_status(name, specVersion, version, 'approved')`
4. 建议下一步：`load_skill execute-plan`

## 重要规则

- 每步具体到"做什么"和"怎么做"——"实现登录"拆成"创建 LoginForm"等
- 验收条件都是可检查的事实
- 无 TODO、待定、占位符
- 无 return_skill——用 load_skill
