# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![中文文档](https://img.shields.io/badge/docs-中文-blue.svg)](./README.zh_CN.md)

**Wrangler** is a pnpm-based TypeScript monorepo — the abstraction layer between the [colts](https://github.com/agentskillmania/colts) ReAct framework and a usable agent system. It provides agent/crew configuration loading, the `EnhancedRunner` entry point, skill management, and development tooling.

## Packages

| Package | Description |
|---------|-------------|
| [`@agentskillmania/wrangler`](./packages/wrangler/) | Core library — agent & crew configuration loading, `EnhancedRunner`, skill management, workspace composition, and MCP tool integration |
| [`@agentskillmania/wrangler-devtool`](./packages/wrangler-devtool/) | Development toolkit — project scaffolding, evaluation framework, and built-in skills |
| [`@agentskillmania/wrangler-daemon`](./packages/wrangler-daemon/) | HTTP API server — exposes agent sessions, skill management, and devtool endpoints via REST/SSE |

## Quick Start

```bash
# Clone and install
git clone https://github.com/agentskillmania/wrangler.git
cd wrangler
pnpm install

# Build all packages
pnpm build

# Start the HTTP API server (exposes agent sessions + devtool endpoints)
npx wrangler-daemon
```

Place a `wrangler.yaml` in your project directory (or `~/.agentskillmania/skill-studio/config.yaml`):

```yaml
llm:
  providers:
    - name: openai
      apiKey: sk-your-key
      baseUrl: https://api.openai.com/v1  # optional
      models:
        - modelId: gpt-4o
```

## Usage

### Run an agent from `AGENT.md`

Create an agent directory with an `AGENT.md` (YAML frontmatter for name/instructions, optional `skills/` and `mcp.json`), then:

```typescript
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';

// 1. Load the agent definition
const agent = await AgentLoader.loadFrom('./my-agent');

// 2. Create the runner (llmClient: any ILLMProvider, e.g. createLLMClient or your own)
const runner = await EnhancedRunner.create({
  llm: { client: llmClient, model: 'gpt-4o' },
  workspacePath: process.cwd(),
  skills: { dirs: agent.skillDirs },
  tools: { mcpConfigPaths: agent.mcpPaths },
});

// 3. Run — events stream via runner.on(...), result is blocking
runner.on('tool:start', ({ action }) => console.log('tool:', action.tool));
runner.on('token', ({ token }) => process.stdout.write(token));

let state = createAgentState({ name: agent.name, instructions: agent.instructions, tools: [] });
state = addUserMessage(state, '请审查这个项目');
const { result } = await runner.run(state);
```

### Run a crew from `CREW.md`

A crew is a configuration layer, not a separate runtime: `CrewLoader` parses `CREW.md` + `agents/*.md`, and `crewToRunnerOptions()` converts them into `EnhancedRunner` options. The primary agent runs as a normal agent; other agents become sub-agents invoked via the `delegate` tool (sub-agents inherit the parent's tools and skills).

```typescript
import { CrewLoader, crewToRunnerOptions, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';

const crew = await new CrewLoader('./my-crew').load();

const runner = await EnhancedRunner.create({
  ...crewToRunnerOptions(crew),
  llm: { client: llmClient, model: 'gpt-4o' },
  workspacePath: process.cwd(),
});

let state = createAgentState({ name: crew.meta.primaryAgent, instructions: '', tools: [] });
state = addUserMessage(state, '调研这个选题并写一篇报道');
const { result } = await runner.run(state);
```

### Key options of `EnhancedRunner.create`

| Option | Meaning |
|--------|---------|
| `llm.client` / `llm.quickInit.providers` | LLM provider injection, or quick init from provider list |
| `systemPrompt` | Extra system prompt (merged with the built-in time header) |
| `skills.dirs` / `skills.provider` | Skill directories to scan; or an injected `ISkillProvider` (e.g. OPFS-backed in browsers) |
| `tools.deps` / `tools.builtinFilter` / `tools.mcpConfigPaths` | Tool dependencies (host OS access), builtin tool whitelist, MCP configs |
| `runtime` | Host environment (defaults to `NodeHostEnv`; browsers inject a HostEnv over OPFS) |
| `sandbox`, `thinking`, `session`, `commands`, `specPlan`, `todolist`, `a2ui` | Feature groups |
| `subAgents` | Sub-agent configs (enables the `delegate` tool) |

## Development with Devtool

```bash
# Initialize a project (agent | crew | skill)
npx wrangler-devtool init --type agent ./my-agent
npx wrangler-devtool init --type crew ./my-crew

# Create resources
npx wrangler-devtool create agent my-bot
npx wrangler-devtool create skill search-web
npx wrangler-devtool create crew dev-team

# Run eval suites
npx wrangler-devtool eval evals/baseline.yaml
npx wrangler-devtool eval evals/baseline.yaml --runs 5 --reporter json
```

See [`wrangler-devtool` documentation](./packages/wrangler-devtool/README.md) for full CLI reference.

## Development

```bash
pnpm build              # Build all packages
pnpm dev                # Watch mode
pnpm test:unit          # Unit tests only
pnpm test:intg          # Integration tests (requires .env with API keys + ENABLE_INTEGRATION_TESTS=true)
pnpm test:coverage      # Coverage report (90% threshold)
pnpm lint               # ESLint
pnpm lint:fix           # ESLint auto-fix
pnpm format:check       # Prettier check
pnpm changeset          # Create changeset
pnpm release            # Build + publish
```

## Architecture

```
wrangler-daemon ──depends──► wrangler
wrangler-devtool ─depends──► wrangler
wrangler ────────depends──► colts, llm-client
```

Wrangler sits on top of the colts framework:

- **colts** provides the ReAct agent runner, execution engine, sub-agent delegation, and event primitives
- **llm-client** provides unified LLM access with concurrency control
- **wrangler** adds agent loading (from `AGENT.md`), crew definition (from `CREW.md`), skill composition, and `EnhancedRunner`. A crew is not a runtime orchestrator — `CrewLoader.load()` parses a crew directory and `crewToRunnerOptions()` converts it into `EnhancedRunner.create({ subAgents })` options. The `CREW.md` body is injected into the primary agent's system prompt, and non-primary agents become sub-agents reachable via colts' `delegate` tool.
- **wrangler-devtool** provides development tooling for building, testing, and evaluating agents
- **wrangler-daemon** provides the HTTP API server for upper-layer applications

## Requirements

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0 (enforced via `preinstall` script)

## License

MIT
