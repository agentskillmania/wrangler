# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Core library for agent configuration and multi-agent crews — the abstraction layer between the [colts](https://github.com/agentskillmania/colts) ReAct framework and a usable multi-agent system.

## Features

- **EnhancedRunner** — extends colts `AgentRunner` with workspace composition, skill directories, thinking support, and Markdown context assembly
- **Crew as configuration** — load a crew directory (`CREW.md` + per-agent `AGENT.md`) and convert it into `EnhancedRunner.create({ subAgents })` options. The primary agent becomes the main runner; other agents become sub-agents reachable via colts' `delegate` tool. `CREW.md` body is injected into the primary agent's system prompt.
- **Agent loading** — parse `AGENT.md` files to define agent identity, instructions, and skill directories
- **Session management** — session store, transcript formatting, and conversation metadata
- **Builtin tools** — calculate, ask_human, file read/write/edit, grep, glob, shell, web-fetch, web-search with workspace sandboxing
- **MCP integration** — load tools from MCP servers via `loadMCPTools`
- **Spec/Plan system** — structured specification and plan documents for complex workflows
- **Todolist support** — shared todo state for agents

## Architecture Layers

| Layer | Module | Description |
|-------|--------|-------------|
| 2 | `runner/`, `tools/` | EnhancedRunner, builtin & MCP tools |
| 3 | `todolist/` | Shared todolist state |
| 4 | `spec-plan/`, `loader/` | Spec/Plan documents, AgentLoader |
| 5 | `agent/` | AGENT.md parsing |
| 8 | `crew/` | Crew config loader (`CrewLoader` → `crewToRunnerOptions`) |

## Installation

```bash
pnpm add @agentskillmania/wrangler
```

## Quick Example

```typescript
import { EnhancedRunner, AgentLoader } from '@agentskillmania/wrangler';
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

// Consume execution via the EventEmitter (single observability channel)
runner.on('token', (e) => process.stdout.write(e.token));
runner.on('subagent:token', (e) => process.stdout.write(e.token)); // live sub-agent output

const { result } = await runner.run(state);
console.log('Done:', result.type);
```

## Loading a Crew

A crew is a directory of configuration, not a runtime orchestrator. `CrewLoader.load()` parses `CREW.md` and the per-agent `AGENT.md` files; `crewToRunnerOptions()` turns that into `EnhancedRunner.create({ subAgents })` options. Inter-agent work happens through the `delegate` tool, and sub-agent events bubble up to the runner's EventEmitter with a `subagent:` prefix.

```typescript
import { CrewLoader, crewToRunnerOptions, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState } from '@agentskillmania/colts';

const crew = await new CrewLoader('./my-crew').load();
const opts = crewToRunnerOptions(crew);

const runner = await EnhancedRunner.create({
  llm: { client: llmClient, model: opts.model ?? 'gpt-4o' },
  // crew's composed prompt (memory + primary instructions + sub-agent
  // catalog) rides through agentInstructions → AgentState.config.instructions
  delegation: { subAgents: opts.subAgents },
  skills: { dirs: opts.skillDirs },
  crewId: 'my-crew', // persisted into runnerConfig snapshot so resume can detect crew sessions
});

// The primary agent's instructions come from opts.systemPrompt — pass them
// into createAgentState the same way you would for a single agent.
const state = createAgentState({
  name: opts.primaryAgent,
  instructions: opts.systemPrompt,
  tools: runner.getToolInfo(),
});
```

### Resuming a crew session

`EnhancedRunner.resume()` reconstructs the runner from the persisted `meta.yaml` snapshot. The snapshot does not store `subAgents` (they are a runtime concept), so you must pass them back in via `ResumeOptions.subAgents` — typically by reloading the crew config with the `crewId` that was written into the snapshot at create time:

```typescript
const { runner, state } = await EnhancedRunner.resume(sessionDir, {
  llm: { client: llmClient },
  subAgents: opts.subAgents, // rebuilt from CrewLoader + crewToRunnerOptions
});
```

## Configuration

`EnhancedRunner.create()` accepts structured config groups:

```typescript
await EnhancedRunner.create({
  workspacePath: '/project',

  llm: {
    client: llmClient,           // or quickInit for multi-provider
    model: 'gpt-4o',
    temperature: 0.7,
    requestTimeout: 120_000,
  },
  skills: { dirs: ['/skills'] },
  tools: {
    builtinFilter: { shell: true, python: false }, // whitelist
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

Legacy flat fields (`llmClient`, `enableSession`, `skillDirs`, `sandbox: true`, etc.) were removed — all options live in the structured groups above. For per-request overrides (model, thinking) see `ResumeOptions`; the daemon exposes the same groups in its chat request `config`.

## Dependencies

- [`@agentskillmania/colts`](https://github.com/agentskillmania/colts) — ReAct agent framework
- [`@agentskillmania/llm-client`](https://github.com/agentskillmania/colts) — Unified LLM client

## License

MIT
