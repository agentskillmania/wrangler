# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

智能体配置与多 Agent 团队核心库 —— [colts](https://github.com/agentskillmania/colts) ReAct 框架与可用多 Agent 系统之间的抽象层。

## 功能特性

- **EnhancedRunner** — 在 colts `AgentRunner` 基础上扩展 workspace 组合、Skill 目录、Thinking 支持和 Markdown 上下文组装
- **Crew 即配置** — 加载团队目录（`CREW.md` + 各 Agent 的 `AGENT.md`），转换为 `EnhancedRunner.create({ subAgents })` 选项。主 Agent 成为主 Runner，其余 Agent 成为可通过 colts `delegate` 工具调用的子代理。`CREW.md` 正文注入主 Agent 的 system prompt。
- **Agent 加载** — 解析 `AGENT.md` 文件定义 Agent 身份、指令和 Skill 目录
- **Session 管理** — Session 存储、对话格式化和元数据管理
- **内置工具** — 文件读写编辑、grep、glob、shell、web-fetch、web-search，带 workspace 沙箱
- **MCP 集成** — 通过 `loadMCPTools` 从 MCP 服务器加载工具
- **Spec/Plan 系统** — 面向复杂工作流的结构化规格和计划文档
- **Todolist 支持** — Agent 共享的 Todo 状态

## 架构层级

| 层级 | 模块 | 描述 |
|------|------|------|
| 2 | `runner/`、`tools/` | EnhancedRunner、内置工具与 MCP 工具 |
| 3 | `todolist/` | 共享 Todolist 状态 |
| 4 | `spec-plan/`、`loader/` | Spec/Plan 文档、AgentLoader |
| 5 | `agent/` | AGENT.md 解析 |
| 8 | `crew/` | 团队配置加载器（`CrewLoader` → `crewToRunnerOptions`） |

## 安装

```bash
pnpm add @agentskillmania/wrangler
```

## 快速示例

```typescript
import { EnhancedRunner, AgentLoader, createBuiltinTools } from '@agentskillmania/wrangler';
import { LLMClient } from '@agentskillmania/llm-client';

const llmClient = new LLMClient();
llmClient.registerProvider({ name: 'openai', maxConcurrency: 5 });
llmClient.registerApiKey({
  key: process.env.OPENAI_API_KEY!,
  provider: 'openai',
  models: [{ modelId: 'gpt-4o', maxConcurrency: 5 }],
});

const runner = await EnhancedRunner.create({
  workspacePath: '/path/to/project',
  llm: { client: llmClient, model: 'gpt-4o' },
  thinking: { enabled: true },
  sandbox: { enabled: true },
});

const state = runner.createState();

// 通过 EventEmitter 消费执行过程（唯一观测通道）
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('subagent:token', (e) => process.stdout.write(e.token)); // 子代理实时输出

const { result } = await runner.run(state);
console.log('完成:', result.type);
```

## 加载团队

团队是配置目录，而非运行时编排器。`CrewLoader.load()` 解析 `CREW.md` 和各 Agent 的 `AGENT.md`；`crewToRunnerOptions()` 将其转换为 `EnhancedRunner.create({ subAgents })` 选项。Agent 间的协作通过 `delegate` 工具完成，子代理事件以 `subagent:` 前缀冒泡到 Runner 的 EventEmitter。

```typescript
import { CrewLoader, crewToRunnerOptions, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState } from '@agentskillmania/colts';

const crew = await new CrewLoader('./my-crew').load();
const opts = crewToRunnerOptions(crew);

const runner = await EnhancedRunner.create({
  llm: { client: llmClient, model: opts.model ?? 'gpt-4o' },
  // 团队的合成 prompt（memory + 主 Agent 指令 + 子代理目录）通过
  // agentInstructions → AgentState.config.instructions 传递
  delegation: { subAgents: opts.subAgents },
  skills: { dirs: opts.skillDirs },
  crewId: 'my-crew', // 写入 runnerConfig 快照，resume 时据此识别团队会话
});

// 主 Agent 的指令来自 opts.systemPrompt —— 与单 Agent 一样传给 createAgentState
const state = createAgentState({
  name: opts.primaryAgent,
  instructions: opts.systemPrompt,
  tools: runner.getToolInfo(),
});
```

### 恢复团队会话

`EnhancedRunner.resume()` 从持久化的 `meta.yaml` 快照重建 Runner。快照不存储 `subAgents`（属于运行时概念），因此需要通过 `ResumeOptions.subAgents` 重新传入 —— 通常的做法是用创建时写入快照的 `crewId` 重新加载团队配置：

```typescript
const { runner, state } = await EnhancedRunner.resume(sessionDir, {
  llm: { client: llmClient },
  subAgents: opts.subAgents, // 由 CrewLoader + crewToRunnerOptions 重建
});
```

## 配置

`EnhancedRunner.create()` 接受结构化的配置组：

```typescript
await EnhancedRunner.create({
  workspacePath: '/project',

  llm: {
    client: llmClient,           // 或 quickInit 支持多 provider
    model: 'gpt-4o',
    temperature: 0.7,
    requestTimeout: 120_000,
  },
  skills: { dirs: ['/skills'] },
  tools: {
    builtinFilter: { shell: true, python: false }, // 白名单
    mcpConfigPaths: ['./mcp.json'],
    askHumanHandler: myHandler,
  },
  sandbox: { enabled: true },
  thinking: { enabled: true, promptLevel: false },
  session: { enabled: true, baseDir: '/sessions' },
  todolist: { enabled: true },
  specPlan: { enabled: true },
  commands: { enabled: true },
  a2ui: { enabled: false },
  delegation: { subAgents: [...] },
  limits: { maxSteps: 500 },
  compression: { strategy: 'summarize', threshold: 50 },
});
```

旧版扁平字段（`llmClient`、`enableSession`、`skillDirs`、`sandbox: true` 等）已移除——所有选项都通过上面的结构化组传入。按请求覆盖（model、thinking）见 `ResumeOptions`；daemon 的聊天请求 `config` 暴露同样的配置组。

## 依赖

- [`@agentskillmania/colts`](https://github.com/agentskillmania/colts) — ReAct Agent 框架
- [`@agentskillmania/llm-client`](https://github.com/agentskillmania/colts) — 统一 LLM 客户端

## License

MIT
