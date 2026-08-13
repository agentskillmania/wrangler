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
- **MCP integration** — host injects a loader from the `./tools/mcp` subpath (not bundled in the engine core)
- **Spec/Plan system** — structured specification and plan documents for complex workflows
- **Todolist support** — shared todo state for agents

## Architecture Layers

| Layer | Module                  | Description                                               |
| ----- | ----------------------- | --------------------------------------------------------- |
| 2     | `runner/`, `tools/`     | EnhancedRunner, builtin & MCP tools                       |
| 3     | `todolist/`             | Shared todolist state                                     |
| 4     | `spec-plan/`, `loader/` | Spec/Plan documents, AgentLoader                          |
| 5     | `agent/`                | AGENT.md parsing                                          |
| 8     | `crew/`                 | Crew config loader (`CrewLoader` → `crewToRunnerOptions`) |

## Installation

```bash
pnpm add @agentskillmania/wrangler
```

## Quick Example

```typescript
import { EnhancedRunner } from '@agentskillmania/wrangler';
import { NodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { LLMClient } from '@agentskillmania/llm-client';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';

const llmClient = LLMClient.quickInit({
  providers: [
    {
      name: 'openai',
      apiKey: process.env.OPENAI_API_KEY!,
      models: [{ modelId: 'gpt-4o', maxConcurrency: 5 }],
    },
  ],
});

const runner = await EnhancedRunner.create({
  runtime: new NodeHostEnv(), // required — engine core has no Node imports
  workspacePath: '/path/to/project',
  llm: { client: llmClient, model: 'gpt-4o' },
  thinking: { enabled: true },
  sandbox: { enabled: false },
});

let state = createAgentState({ name: 'agent', instructions: '...', tools: [] });
state = addUserMessage(state, '你好');

// Consume execution via the EventEmitter (single observability channel)
runner.on('token', (e) => process.stdout.write(e.token));

const { result } = await runner.run(state);
console.log('Done:', result.type);
```

## Loading a Crew

A crew is a directory of configuration, not a runtime orchestrator. `CrewLoader.load()` parses `CREW.md` and the per-agent `AGENT.md` files; `crewToRunnerOptions()` turns that into `EnhancedRunner.create({ subAgents })` options. Inter-agent work happens through the `delegate` tool, and sub-agent events bubble up to the runner's EventEmitter with a `subagent:` prefix.

```typescript
import { CrewLoader, crewToRunnerOptions, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState } from '@agentskillmania/colts';

const crew = await new CrewLoader('./my-crew', new NodeHostEnv()).load();
const opts = crewToRunnerOptions(crew);

const runner = await EnhancedRunner.create({
  runtime: new NodeHostEnv(), // required
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
  runtime: new NodeHostEnv(), // required
  llm: { client: llmClient },
  subAgents: opts.subAgents, // rebuilt from CrewLoader + crewToRunnerOptions
});
```

## Configuration

`EnhancedRunner.create()` accepts structured config groups:

```typescript
import { createWebTools } from '@agentskillmania/wrangler/tools/web';   // Node-only (jsdom)
import { loadMCPTools } from '@agentskillmania/wrangler/tools/mcp';     // Node-only (MCP)
import { Sandbox } from '@agentskillmania/sandbox';

await EnhancedRunner.create({
  runtime: new NodeHostEnv(),           // required
  workspacePath: '/project',

  llm: {
    client: llmClient,           // or quickInit: { providers } + quickInitFactory (host-injected creator, e.g. (p) => LLMClient.quickInit({ providers: p }))
    model: 'gpt-4o',
    temperature: 0.7,
    requestTimeout: 120_000,
  },
  skills: { dirs: ['/skills'] },
  tools: {
    builtinFilter: { shell: true, python: false }, // whitelist over the 10 core tools
    // Node-only tools are host-assembled and injected — not bundled in the main entry:
    injectFactory: (deps) => createWebTools({ deps, provider: 'sogou' }),
    mcpConfigPaths: ['./mcp.json'],
    mcpLoader: (paths) => loadMCPTools({ configPaths: paths }),
    askHumanHandler: myHandler,
  },
  sandbox: {
    enabled: true,
    instance: new Sandbox({ sandboxDir: '/project' }), // host-constructed
  },
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
