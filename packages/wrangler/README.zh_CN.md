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
  llmClient,
  model: 'gpt-4o',
  workspacePath: '/path/to/project',
  thinkingEnabled: true,
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

const crew = await new CrewLoader('./my-crew').load();
const opts = crewToRunnerOptions(crew);

const runner = await EnhancedRunner.create({
  llmClient,
  model: opts.model ?? 'gpt-4o',
  systemPrompt: opts.systemPrompt,
  subAgents: opts.subAgents,
  skillDirectories: opts.skillDirs,
});
```

## 依赖

- [`@agentskillmania/colts`](https://github.com/agentskillmania/colts) — ReAct Agent 框架
- [`@agentskillmania/llm-client`](https://github.com/agentskillmania/colts) — 统一 LLM 客户端

## License

MIT
