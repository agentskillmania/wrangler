# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Core library for agent crew orchestration — the abstraction layer between the [colts](https://github.com/agentskillmania/colts) ReAct framework and a usable multi-agent system.

## Features

- **EnhancedRunner** — extends colts `AgentRunner` with workspace composition, skill directories, thinking support, and Markdown context assembly
- **Crew orchestration** — multi-agent crew execution with message routing, shared todolist, and liaison coordination
- **Agent loading** — parse `AGENT.md` files to define agent identity, instructions, and skill directories
- **Crew loading** — load `crew.yaml` definitions with agent roles and inter-agent tools
- **Session management** — session store, transcript formatting, and conversation metadata
- **Builtin tools** — file read/write/edit, grep, glob, shell, web-fetch, web-search with workspace sandboxing
- **MCP integration** — load tools from MCP servers via `loadMCPTools`
- **Spec/Plan system** — structured specification and plan documents for complex workflows
- **Todolist support** — shared todo state for agents and crews

## Architecture Layers

| Layer | Module | Description |
|-------|--------|-------------|
| 2 | `runner/`, `tools/` | EnhancedRunner, builtin & MCP tools |
| 3 | `todolist/` | Shared todolist state |
| 4 | `spec-plan/`, `loader/` | Spec/Plan documents, AgentLoader |
| 5 | `agent/` | AGENT.md parsing |
| 8 | `crew/` | Full crew orchestration |

## Installation

```bash
pnpm add @agentskillmania/wrangler
```

## Quick Example

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

## Dependencies

- [`@agentskillmania/colts`](https://github.com/agentskillmania/colts) — ReAct agent framework
- [`@agentskillmania/llm-client`](https://github.com/agentskillmania/colts) — Unified LLM client

## License

MIT
