# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

Agent Crew 编排核心库 —— [colts](https://github.com/agentskillmania/colts) ReAct 框架与可用多 Agent 系统之间的抽象层。

## 功能特性

- **EnhancedRunner** — 在 colts `AgentRunner` 基础上扩展 workspace 组合、Skill 目录、Thinking 支持和 Markdown 上下文组装
- **Crew 编排** — 多 Agent Crew 执行，支持消息路由、共享 Todolist 和联络员协调
- **Agent 加载** — 解析 `AGENT.md` 文件定义 Agent 身份、指令和 Skill 目录
- **Crew 加载** — 加载 `crew.yaml` 定义，包含 Agent 角色和 Agent 间通信工具
- **Session 管理** — Session 存储、对话格式化和元数据管理
- **内置工具** — 文件读写编辑、grep、glob、shell、web-fetch、web-search，带 workspace 沙箱
- **MCP 集成** — 通过 `loadMCPTools` 从 MCP 服务器加载工具
- **Spec/Plan 系统** — 面向复杂工作流的结构化规格和计划文档
- **Todolist 支持** — Agent 和 Crew 共享的 Todo 状态

## 架构层级

| 层级 | 模块 | 描述 |
|------|------|------|
| 2 | `runner/`、`tools/` | EnhancedRunner、内置工具与 MCP 工具 |
| 3 | `todolist/` | 共享 Todolist 状态 |
| 4 | `spec-plan/`、`loader/` | Spec/Plan 文档、AgentLoader |
| 5 | `agent/` | AGENT.md 解析 |
| 8 | `crew/` | 完整的 Crew 编排 |

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
const stream = runner.runStream(state);
for await (const event of stream) {
  console.log(event.type, event);
}
```

## 依赖

- [`@agentskillmania/colts`](https://github.com/agentskillmania/colts) — ReAct Agent 框架
- [`@agentskillmania/llm-client`](https://github.com/agentskillmania/colts) — 统一 LLM 客户端

## License

MIT
