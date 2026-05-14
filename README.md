# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![中文文档](https://img.shields.io/badge/docs-中文-blue.svg)](./README.zh_CN.md)

**Wrangler** is a pnpm-based TypeScript monorepo providing agent crew orchestration, skill management, and an interactive TUI — the abstraction layer between the [colts](https://github.com/agentskillmania/colts) ReAct framework and a usable multi-agent system.

## Packages

| Package | Description |
|---------|-------------|
| [`@agentskillmania/wrangler`](./packages/wrangler/) | Core library — agent crew orchestration, `EnhancedRunner`, skill management, workspace composition, and MCP tool integration |
| [`@agentskillmania/wrangler-cli`](./packages/wrangler-cli/) | Terminal UI (Ink + React) — interactive agent chat with streaming, thinking display, setup wizard, and multi-session support |
| [`@agentskillmania/wrangler-devtool`](./packages/wrangler-devtool/) | Development tooling and utilities |

## Quick Start

```bash
# Clone and install
git clone https://github.com/agentskillmania/wrangler.git
cd wrangler
pnpm install

# Build all packages
pnpm build

# Launch the TUI (first run opens setup wizard for LLM config)
npx wrangler .
```

The setup wizard writes to `~/.agentskillmania/wrangler/config.yaml`. Alternatively, place a `wrangler.yaml` in your project directory:

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
  baseUrl: https://api.openai.com/v1  # optional
```

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
wrangler-cli ────depends───► wrangler
wrangler-devtool ─depends──► wrangler
wrangler ────────depends──► colts, llm-client
```

Wrangler sits on top of the colts framework:

- **colts** provides the ReAct agent runner, execution engine, and streaming primitives
- **llm-client** provides unified LLM access with concurrency control
- **wrangler** adds crew orchestration, agent loading (from `AGENT.md`), crew definition (from `crew.yaml`), skill composition, and `EnhancedRunner`
- **wrangler-cli** provides the terminal UI for interactive use

## Requirements

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0 (enforced via `preinstall` script)

## License

MIT
