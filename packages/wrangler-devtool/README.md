# @agentskillmania/wrangler-devtool

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler-devtool.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler-devtool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Wrangler Devtool** is the development toolkit for the Wrangler ecosystem. It does three things:

1. **Scaffolds** agent/skill project directories
2. **Provides** built-in skills that upper-layer agents can load
3. **Evaluates** agents and skills via a YAML-defined test framework

No AI logic lives in devtool itself — generation, review, and orchestration are handled by the built-in skills, which upper-layer agents (e.g. skill-studio) load via `load_skill`.

## Installation

```bash
pnpm add -D @agentskillmania/wrangler-devtool
```

Or use directly via npx:

```bash
npx wrangler-devtool --help
```

## Commands

### `init` — Initialize a project

Creates a new agent or skill project directory with standard structure (AGENT.md, skills/, evals/, mcp.json, .gitignore, git repo).

```bash
wrangler-devtool init --type agent ./my-agent
wrangler-devtool init --type crew ./my-crew
wrangler-devtool init --type skill ./my-skill
wrangler-devtool init --type agent --no-git ./my-agent
```

Generated structure:

```
my-agent/
├── AGENT.md          # Agent definition (frontmatter + instructions)
├── skills/           # Skills this agent can load
│   └── example.md
├── evals/            # Evaluation suites
│   └── example.yaml
├── mcp.json          # MCP server config
├── .gitignore        # Ignores .eval/ and node_modules/
└── .git/
```

### `create` — Create a scaffold file

Generates an empty agent, skill, or crew template file.

```bash
wrangler-devtool create agent my-bot
wrangler-devtool create skill search-web
wrangler-devtool create crew dev-team
```

### `eval` — Run evaluation suite

Runs a YAML-defined evaluation suite against an agent or skill. Supports multi-run sampling, deterministic evaluators, and LLM-as-Judge.

```bash
# Run with defaults
wrangler-devtool eval evals/baseline.yaml

# Override sampling
wrangler-devtool eval evals/baseline.yaml --runs 5

# Custom output directory
wrangler-devtool eval evals/baseline.yaml --output ./reports

# JSON output (for CI)
wrangler-devtool eval evals/baseline.yaml --reporter json
```

**Options:**

| Flag | Description |
|---|---|
| `--runs N` | Override `sampling.runs` |
| `--output DIR` | Output directory (default: `.eval/runs/<runId>`) |
| `--reporter console\|json` | Output format (default: `console`) |
| `--keep-traces` | Keep temporary workspaces after run |

## Evaluation Framework

### Suite YAML format

```yaml
name: code-reviewer-eval
description: Evaluate the code-reviewer agent

target:
  type: agent              # agent | skill
  path: ./                 # agent definition dir (for skill: skill parent dir)
  skill: null              # when type=skill, the skill name to load

sampling:
  runs: 3                  # run each case 3 times
  passThreshold: 0.67      # 2/3 passes required
  # temperature: 0         # uncomment for deterministic single-run mode
  # maxSteps: 20           # max agent steps per run

cases:
  - name: detect-sql-injection
    description: Should detect SQL injection
    input:
      message: Review this code for security issues
    context:
      files:               # fixture files copied into temp workspace
        - source: fixtures/vulnerable.py
          target: src/main.py
      env:
        MODE: strict
    evaluators:
      - type: output_contains
        value: "SQL injection"
        caseInsensitive: true
      - type: tool_called
        tool: file_read
      - type: file_exists
        path: review.md
      - type: llm-judge
        name: thoroughness
        criteria: Coverage of security, performance, maintainability
        rubric:
          - { score: 5, description: Comprehensive }
          - { score: 1, description: Missing key issues }
        minScore: 3
```

### Built-in evaluators

**Deterministic:**

| Type | Description |
|---|---|
| `output_contains` / `output_not_contains` | Check answer text (with `caseInsensitive`) |
| `output_equals` | Exact match |
| `output_matches` | Regex match (with `flags`) |
| `tool_called` / `tool_not_called` | Whether a specific tool was invoked |
| `tool_called_with` | Tool called with matching arguments (subset) |
| `tool_call_count` | Number of tool calls within `min`/`max` range |
| `file_exists` / `file_not_exists` | File presence in workspace (with `contentContains`) |
| `exit_code` | Run result type (`success`, `error`, `max_steps`, etc.) |
| `step_count` | Steps within `min`/`max` range |

**LLM-as-Judge:**

| Type | Description |
|---|---|
| `llm-judge` | LLM evaluates the full trace (answer + tool calls) against `criteria` and `rubric`. Supports `reference` golden answer. Uses `temperature: 0` for determinism. |

### Output structure

```
.eval/runs/2026-07-14T09-00-00-my-suite/
├── report.json                          # Structured report
└── traces/
    ├── detect-sql-injection.sample-0.jsonl   # Per case × per sample
    ├── detect-sql-injection.sample-1.jsonl
    └── detect-sql-injection.sample-2.jsonl
```

Trace files are JSONL — one JSON event per line (`meta`, `input`, `tool_call`, `tool_result`, `final`, `stats`).

## Built-in Skills

Devtool ships five skills that upper-layer agents can load via `load_skill`:

| Skill | Purpose |
|---|---|
| `agent-architect` | Design and write agent definitions |
| `skill-designer` | Design and write skill definitions |
| `crew-composer` | Compose multi-agent crew definitions |
| `definition-reviewer` | Review agent/skill/crew definitions for quality |
| `session-curator` | Manage and organize conversation sessions |

Upper-layer applications import `BUILTIN_SKILLS_DIR` and add it to `skillDirs`:

```typescript
import { BUILTIN_SKILLS_DIR } from '@agentskillmania/wrangler-devtool';

const runner = await EnhancedRunner.create({
  skillDirs: [BUILTIN_SKILLS_DIR],
  // ...
});
```

## Configuration

Eval uses the same LLM config as wrangler. Search order (first with `llm.providers` wins):

1. `projectDir/eval-config.yaml` — eval-specific override (supports `judge.model`)
2. `projectDir/wrangler.yaml` — project config
3. `~/.agentskillmania/wrangler/config.yaml` — global config
4. `OPENAI_API_KEY` env var — CI fallback

Example `eval-config.yaml` with separate judge model:

```yaml
llm:
  providers:
    - name: openai
      apiKey: sk-your-key
      baseUrl: https://api.example.com/v1
      models:
        - modelId: glm-5.1    # agent being evaluated
        - modelId: glm-5.2    # available for judge

judge:
  model: glm-5.2              # use a stronger model for judging
```

## Programmatic API

```typescript
import { runEval, loadSuite } from '@agentskillmania/wrangler-devtool';

const suite = await loadSuite('./evals/baseline.yaml');
const { report, outputDir } = await runEval(suite, {
  runs: 3,
  outputDir: './reports',
});
```

## Design Principles

- **Devtool does no AI** — scaffolding and file ops only; AI capabilities live in built-in skills loaded by upper-layer agents
- **Non-interactive** — all commands are scriptable, no prompts or menus
- **Safe changes** — file modifications use `old → new` match verification

## License

MIT
