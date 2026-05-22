# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build, dev, test
pnpm build              # Build all packages (tsc)
pnpm dev                # Watch mode
pnpm test:unit          # Unit tests (all packages)
pnpm test:intg          # Integration tests (requires .env with API keys + ENABLE_INTEGRATION_TESTS=true)
pnpm test:coverage      # Coverage report (90% branch/line/function/statement threshold)

# Quality
pnpm lint               # ESLint on packages/*/src
pnpm lint:fix           # ESLint auto-fix
pnpm format:check       # Prettier check
pnpm format             # Prettier write

# Release
pnpm changeset          # Create changeset
pnpm release            # Build + changeset publish

# Run a single test file
pnpm --filter @agentskillmania/wrangler vitest run test/unit/runner/enhanced-runner.test.ts
pnpm --filter @agentskillmania/wrangler-cli vitest run test/unit/hooks/use-agent.test.ts
pnpm --filter @agentskillmania/wrangler-daemon vitest run test/unit/daemon.test.ts

# Run demos (from packages/wrangler)
pnpm --filter @agentskillmania/wrangler demo:code-reviewer
pnpm --filter @agentskillmania/wrangler demo:travel-concierge
pnpm --filter @agentskillmania/wrangler demo:tech-evaluation
pnpm --filter @agentskillmania/wrangler demo:newsroom
```

## Architecture

Wrangler is a pnpm monorepo that orchestrates agents, skills, and tools into a working crew on top of the [colts](https://github.com/agentskillmania/colts) ReAct framework.

### Dependency graph

```
wrangler-cli ──────depends───► wrangler ────depends───► colts, llm-client, sandbox
wrangler-daemon ───depends───► wrangler, wrangler-devtool
wrangler-devtool ──depends───► wrangler
```

### Packages

- **`packages/wrangler`** — Core library. Agent crew orchestration, EnhancedRunner, skill management, workspace composition, MCP tool integration, session persistence, spec/plan documents, todolist.
- **`packages/wrangler-cli`** — Terminal UI built with Ink + React 18. Interactive agent chat with streaming, thinking display, setup wizard, and multi-session crew mode. Entry point is the `wrangler` CLI binary.
- **`packages/wrangler-daemon`** — HTTP service (Fastify) exposing agent sessions, skill/agent management, workspace file ops, and devtool capabilities as REST + SSE API. Includes playground UI. Entry point is the `wrangler-daemon` CLI binary.
- **`packages/wrangler-devtool`** — Placeholder package for future development tooling.

### Core source layout (`packages/wrangler/src/`)

- **`runner/`** — `EnhancedRunner` wraps colts AgentRunner with builtin tools, MCP tools, session support, and todolist. `markdown-assembler.ts` handles context engineering. `system-prompt.ts` builds system prompts from agent config.
- **`crew/`** — Crew orchestration with three agent roles: **Primary** (entry point, creates tasks), **Liaison** (routes messages between Primary and Worker), **Worker** (executes tasks). `crew-loader.ts` parses CREW.md. `message-router.ts` handles inter-agent routing. `agent-instance.ts` manages individual agent lifecycles.
- **`agent/`** — `agent-loader.ts` parses AGENT.md files with YAML frontmatter (name, description, model, thinking settings, instructions).
- **`loader/`** — Higher-level agent loading from directory structures.
- **`tools/builtin/`** — Workspace-scoped tools: file-read, file-write, file-edit, shell, glob, grep, web-fetch, web-search. All depend on `WorkspaceToolDeps` for path resolution with security boundaries.
- **`tools/mcp/`** — MCP tool loading: `mcp-loader.ts` discovers MCP servers, `tool-converter.ts` converts JSON Schema to Zod, `config-merger.ts` merges MCP configs from multiple sources.
- **`session/`** — Session persistence with `SessionStore`, transcript serialization, meta.yaml read/write.
- **`spec-plan/`** — Spec and Plan document stores with skill-based workflows (write-spec, review-spec, write-plan, review-plan, execute-plan).
- **`todolist/`** — Task management with `todo-tool`, `todo-middleware`, and `todo-state`. Integrated into crew orchestration for task tracking.

### CLI source layout (`packages/wrangler-cli/src/`)

- **`components/`** — Ink React components: `app.tsx` (root), `main-tui.tsx` (layout), `timeline-panel.tsx` (scrollable history), `input-bar.tsx`, `status-bar.tsx`, `ask-dialog.tsx`, `confirm-dialog.tsx`, `setup/setup-wizard.tsx`.
- **`hooks/`** — `use-agent.ts` (core agent lifecycle), `use-stream-consumer.ts` (stream buffering and entry merging), `use-session-manager.ts` (crew mode multi-session).
- **`config.ts`** — YAML config loading, search order: `./wrangler.yaml` → `~/.agentskillmania/wrangler/config.yaml`.
- **`detect-mode.ts`** — Detects agent mode (AGENT.md), crew mode (CREW.md / crew.yaml), or bare mode.

### Agent and crew definition files

**AGENT.md** — YAML frontmatter with `name`, optional `description`, `model`, `thinking` (enabled boolean), followed by Markdown instructions.

**CREW.md** — YAML frontmatter with `name`, `description`, `primary-agent`, followed by crew-level memory/instructions. Expected directory structure:

```
crew/
├── CREW.md
├── agents/       # AGENT.md files for each agent
└── skills/       # Skill directories with SKILL.md
```

### Key patterns

- **colts integration**: Wrangler wraps colts' `AgentRunner`, adding tools, session, and todolist. The `AgentContext` is augmented with `todoList?` via Immer (see `types/colts-augmentation.ts`).
- **Zod for tool schemas**: All builtin and MCP tools use `Tool<ZodTypeAny>`. MCP tools convert JSON Schema → Zod via `jsonSchemaToZod`.
- **Event-driven crew**: `Crew` emits typed events for all state changes. Agent advancement is fire-and-forget with callbacks.
- **Stateless runner**: EnhancedRunner is stateless; state is managed externally via colts' immutable state model.

## Conventions

- **TypeScript**: ES2022 target, NodeNext module resolution — imports must use `.js` extensions
- **No `any` type**: ESLint error (`@typescript-eslint/no-explicit-any`)
- **Unused vars**: Prefix with `_` (ESLint `argsIgnorePattern: '^_'`)
- **No explicit return types**: Disabled (`@typescript-eslint/explicit-function-return-type: off`)
- **Prettier**: Semicolons, single quotes, 2-space indent, ES5 trailing commas, 100-char print width
- **Zod**: Runtime validation for all tool inputs
- **Testing**: Vitest, 90% coverage threshold. Unit tests in `test/unit/{sourceFileName}.test.ts`, integration tests in `test/integration/{userStoryName}.test.ts`
- **Pre-commit hook**: Husky runs `test:unit` → `build` → `format:check` → `lint` on every commit
- **Changesets**: Use `pnpm changeset` for versioning

## Configuration

LLM config is loaded from YAML. Search order: `./wrangler.yaml` → `~/.agentskillmania/wrangler/config.yaml`.

```yaml
llm:
  provider: openai        # openai | anthropic | google | other
  apiKey: sk-your-key
  model: gpt-4o
  baseUrl: https://api.openai.com/v1  # optional
```

Integration tests require a `.env` file with API keys and `ENABLE_INTEGRATION_TESTS=true`.
