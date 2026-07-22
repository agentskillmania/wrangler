# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![中文文档](https://img.shields.io/badge/docs-中文-blue.svg)](./README.zh_CN.md)

**Wrangler** is a pnpm-based TypeScript monorepo providing agent configuration, multi-agent crews, skill management, and development tooling — the abstraction layer between the [colts](https://github.com/agentskillmania/colts) ReAct framework and a usable multi-agent system.

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

Place a `wrangler.yaml` in your project directory (or `~/.agentskillmania/wrangler/config.yaml`):

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
  baseUrl: https://api.openai.com/v1  # optional
```

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

See [`wrangler-devtool` documentation](./packages/wrangler-devtool/) for full CLI reference.

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
