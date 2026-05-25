# Devtool Agent Colts Migration Design

## Context

wrangler-devtool 的 5 个内置智能体（architect、skill-designer、crew-composer、reviewer、session-curator）目前通过裸调 LLM client 实现：拼 prompt → 单条 LLM 调用 → 解析 JSON。这存在三个问题：

1. **没用自家的 colts 框架** — 丧失了工具调用、多步推理、流式输出、状态管理等能力
2. **没有迭代闭环** — 生成质量不可控，没有"生成→审查→修改"的自动循环
3. **工具不可选** — wrangler 的 EnhancedRunner 是全家桶模式，无法按需选用

本设计通过两个改造解决这些问题：
- **wrangler 侧**：EnhancedRunner 全面模块化，每个工具和功能都可独立开关
- **devtool 侧**：用 EnhancedRunner（极简配置）重写所有智能体，实现自动闭环

## 1. EnhancedRunner 模块化

### 1.1 设计原则

- **增量添加**：在现有 `EnhancedRunnerOptions` 上新增选项，不重构现有接口
- **向后兼容**：不传新选项时行为与现在完全一致
- **粒度控制**：每个内置工具和功能模块都可以独立开关

### 1.2 新增选项

```typescript
interface EnhancedRunnerOptions {
  // ...现有选项全部保持不变...

  // 新增：内置工具开关（每个默认 true，向后兼容）
  builtinTools?: {
    fileRead?: boolean;
    fileWrite?: boolean;
    fileEdit?: boolean;
    glob?: boolean;
    grep?: boolean;
    shell?: boolean;
    webSearch?: boolean;
    webFetch?: boolean;
    python?: boolean;
    git?: boolean;
  };

  // 新增：功能模块开关（默认维持现有行为）
  enableSession?: boolean;    // default true
  enableTodolist?: boolean;   // default true
  enableCommands?: boolean;   // default true
  enableA2UI?: boolean;       // default false
}
```

### 1.3 devtool 的配置

devtool 创建 runner 时使用极简配置：

```typescript
const runner = await EnhancedRunner.create({
  llmClient: client,
  model,
  workspacePath: dir,
  builtinTools: {
    fileRead: true,
    fileWrite: true,
    fileEdit: true,
    glob: true,
    grep: true,
    // shell、webSearch、webFetch、python、git 全部不传 → 不加载
  },
  // 不传 enableSession / enableTodolist / enableCommands / ...
  // session、todolist、commands 等维持默认（但无 sessionBaseDir 时不会初始化 session）
  mcpConfigPaths: [],
  skillDirs: [],
});
```

### 1.4 依赖关系

```
devtool → wrangler (EnhancedRunner) → colts (AgentRunner)
```

devtool 只依赖 wrangler，不需要直接依赖 colts。wrangler 是 devtool 的上游包，依赖方向正确。

## 2. 智能体执行流程

### 2.1 生成类智能体（architect、skill-designer、crew-composer）

这三个智能体走"生成→审查→修改"的迭代闭环。

**流程：**

```
for round = 0..maxRounds-1:
  1. 创建 EnhancedRunner（architect prompt + 文件工具）
     → runner.run(state)
     → 智能体分析需求、读现有文件、生成内容

  2. 创建 reviewer runner（或简单 LLM 调用）
     → 对生成内容做 5 维评分

  3. 代码层判断：
     - 全部维度 ≥ threshold → 返回结果
     - 有维度 < threshold → 把审查意见加入上下文，进入下一轮

如果 maxRounds 轮都未通过 → 返回最后一轮结果 + 最后一轮审查报告
```

**每轮的状态传递：**

```typescript
// 第 N+1 轮的 state 包含前 N 轮的完整消息历史 + 审查反馈
const state = createAgentState({ instructions: template });
addUserMessage(state, userPrompt);
addAssistantMessage(state, round1Output);
addUserMessage(state, buildReviewFeedback(review1));
addAssistantMessage(state, round2Output);
addUserMessage(state, buildReviewFeedback(review2));
// ...
```

### 2.2 审查类智能体（reviewer）

reviewer 不需要工具（只评估文本内容），不走迭代闭环。使用 EnhancedRunner（无内置工具）来保持架构一致性。保持现有行为：输入内容 → 输出 `ReviewReport`。

### 2.3 摘要类智能体（session-curator）

session-curator 是简单的文本摘要，不走闭环。保持现有行为：输入文本 → 输出 `SessionSummary`。

## 3. API 设计

### 3.1 DevTool 类新增方法

两个系列的 API：

```typescript
class DevTool {
  // run 系列 — 阻塞调用，直接拿最终结果
  async runAgentArchitect(prompt: string, existingContent?: string, options?: AgentRunOptions): Promise<AgentOutput>;
  async runSkillDesigner(prompt: string, existingContent?: string, options?: AgentRunOptions): Promise<AgentOutput>;
  async runCrewComposer(prompt: string, existingContent?: string, options?: AgentRunOptions): Promise<AgentOutput>;
  async runReviewer(targetPath: string, content: string, prompt?: string, options?: AgentRunOptions): Promise<ReviewReport>;
  async runSessionCurator(text: string, options?: AgentRunOptions): Promise<SessionSummary>;

  // create*Runner 系列 — 返回 runner + state，上层自己控制执行
  createArchitectRunner(prompt: string, existingContent?: string, options?: AgentRunOptions): { runner: EnhancedRunner; state: AgentState };
  createSkillDesignerRunner(prompt: string, existingContent?: string, options?: AgentRunOptions): { runner: EnhancedRunner; state: AgentState };
  createCrewComposerRunner(prompt: string, existingContent?: string, options?: AgentRunOptions): { runner: EnhancedRunner; state: AgentState };
  createReviewerRunner(targetPath: string, content: string, prompt?: string, options?: AgentRunOptions): { runner: EnhancedRunner; state: AgentState };
  createSessionCuratorRunner(text: string, options?: AgentRunOptions): { runner: EnhancedRunner; state: AgentState };
}
```

### 3.2 AgentRunOptions

```typescript
interface AgentRunOptions {
  model?: string;           // 覆盖默认模型
  timeout?: number;         // 超时时间

  // 闭环参数（仅 run 系列有效，create*Runner 不走闭环）
  maxRounds?: number;       // 最大迭代轮数，默认 3
  scoreThreshold?: number;  // 每维最低分，默认 4
}
```

### 3.3 流式支持

`run` 系列是阻塞的。需要流式时用 `create*Runner`：

```typescript
const { runner, state } = devtool.createArchitectRunner(prompt);
for await (const event of runner.runStream(state)) {
  // event 是 colts 原生事件类型，不需要自定义
  // type: 'token' | 'phase-change' | 'tool:start' | 'tool:result' | 'complete' | ...
}
```

### 3.4 向后兼容

现有的 `runAgentArchitect` 等方法签名不变（已有的参数保持原样），新增 `AgentRunOptions` 作为可选参数。现有调用方无需改动。

## 4. 文件改动范围

### 4.1 wrangler 侧

| 文件 | 改动 |
|------|------|
| `packages/wrangler/src/runner/enhanced-runner.ts` | 新增 `builtinTools`、`enableSession`、`enableTodolist`、`enableCommands` 选项处理逻辑 |

### 4.2 devtool 侧

| 文件 | 改动 |
|------|------|
| `packages/wrangler-devtool/src/agents/orchestrator.ts` | 重写：裸调 LLM → 创建 EnhancedRunner + 迭代闭环逻辑 |
| `packages/wrangler-devtool/src/agents/architect.ts` | 重写：用新的 orchestrator 接口 |
| `packages/wrangler-devtool/src/agents/skill-designer.ts` | 重写 |
| `packages/wrangler-devtool/src/agents/crew-composer.ts` | 重写 |
| `packages/wrangler-devtool/src/agents/reviewer.ts` | 重写 |
| `packages/wrangler-devtool/src/agents/session-curator.ts` | 重写 |
| `packages/wrangler-devtool/src/agents/types.ts` | 新增 `AgentRunOptions` |
| `packages/wrangler-devtool/src/devtool.ts` | 新增 `create*Runner` 系列方法 |
| `packages/wrangler-devtool/src/index.ts` | 新增导出 |

### 4.3 不改动的

- `src/agents/prompts/*` — prompt 模板不变
- `src/tools/*` — initProject、createTemplate 等不变
- `src/test-runner/*` — 测试运行器不变
- `src/config.ts` — 配置加载不变
- `src/llm.ts` — LLM client 不变（被 EnhancedRunner 内部接管）

## 5. 测试策略

### 5.1 wrangler 侧

- EnhancedRunner 模块化选项的单元测试
  - 传 `builtinTools: { shell: false }` → 验证工具列表里没有 shell
  - 传 `enableSession: false` → 验证不初始化 session
  - 不传新选项 → 验证行为与改之前一致（回归测试）

### 5.2 devtool 侧

- **orchestrator 闭环逻辑测试**（mock LLM）
  - 评分全过 → 直接返回，不进入第 2 轮
  - 第 1 轮不过 → 第 2 轮过了 → 返回第 2 轮结果
  - 3 轮都不过 → 返回第 3 轮结果 + 审查报告
  - `maxRounds: 1` → 只跑一轮，等同无闭环
- **agent wrapper 测试**
  - `create*Runner` 返回有效的 runner 和 state
  - `run*` 返回正确类型的结果
- **集成测试**（需要 LLM API key）
  - 端到端：architect 生成 → reviewer 审查 → 输出质量可接受
