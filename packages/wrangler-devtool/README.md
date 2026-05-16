# @agentskillmania/wrangler-devtool

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler-devtool.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler-devtool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Wrangler Devtool** is the development toolkit for the Wrangler ecosystem. It provides scaffolding, testing, review, and session management for developers who build agents, skills, and crews.

## Features

### Scaffolding

Initialize workspaces and generate agent/skill/crew definitions.

```bash
# Initialize workspace
wrangler-devtool init --mode agent ./my-agent
wrangler-devtool init --mode crew ./my-crew

# Generate empty scaffold
wrangler-devtool agent create coder
wrangler-devtool skill create writing
wrangler-devtool crew create research
```

### AI-Powered Generation

Built-in agents generate or modify definitions from natural language prompts.

```bash
# Generate agent with AI
wrangler-devtool agent write --prompt "You are a senior React developer"

# Modify existing agent
wrangler-devtool agent write coder --prompt "Add TypeScript support"

# Generate skill
wrangler-devtool skill write --prompt "Handle user refund requests"

# Generate crew
wrangler-devtool crew write --prompt "A researcher and a writer working together"
```

**Safety:** Changes use structured `old → new` format with match verification. Default `--dry-run`; `--apply` required to write.

### Testing

Declarative test framework with YAML-based test cases.

```bash
# Run all tests
wrangler-devtool test ./my-agent

# Run single case
wrangler-devtool test ./my-agent --case "basic-math"

# Skip soft evaluations (faster)
wrangler-devtool test ./my-agent --hard-only

# JSON output
wrangler-devtool test ./my-agent --reporter json
```

**Test case format (`test/*.yaml`):**

```yaml
name: Basic math
description: Verify agent can calculate

input:
  message: "Calculate 23 * 47"

expected:
  hard:
    - type: output_contains
      value: "1081"
    - type: tool_called
      tool: shell
  soft:
    - name: Response is polite
      criteria: Evaluate whether the response is polite and professional.
      rubric:
        - score: 1
          description: "Rude or aggressive"
        - score: 5
          description: "Friendly and professional"
      minScore: 4
```

### Review

Read-only quality review of agent/skill/crew definitions.

```bash
# Static checks only
wrangler-devtool review ./my-agent

# Deep LLM-based review
wrangler-devtool review ./my-agent --deep

# Focus on specific aspects
wrangler-devtool review ./my-agent --deep --prompt "Check for security issues"
```

### Session Management

```bash
# List sessions
wrangler-devtool session list
wrangler-devtool session list /path/to/project

# Fork session from message N
wrangler-devtool session fork <session-id> --msg=5
```

## Installation

```bash
pnpm add -D @agentskillmania/wrangler-devtool
```

Or use directly via npx:

```bash
npx wrangler-devtool --help
```

## Configuration

Devtool reuses the wrangler CLI configuration (`wrangler.yaml` or `~/.agentskillmania/wrangler/config.yaml`):

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
```

## CLI Reference

```
wrangler-devtool <command>

Commands:
  init --mode <agent|crew|bare> [dir]    Initialize workspace
  agent create <name>                    Create empty agent scaffold
  agent write [name] --prompt <text>     Generate/modify agent with AI
  skill create <name>                    Create empty skill scaffold
  skill write [name] --prompt <text>     Generate/modify skill with AI
  crew create <name>                     Create empty crew scaffold
  crew write [name] --prompt <text>      Generate/modify crew with AI
  test <path> [options]                  Run declarative tests
  review <path> [options]                Review quality (read-only)
  session list [workspace]               List sessions
  session fork <id> --msg=N              Fork session

Global Options:
  --help     Show help
  --version  Show version
```

## Design Principles

- **Non-interactive by default** — All commands are fully scriptable. No prompts, no menus.
- **Safe changes** — File modifications use `old → new` match verification. No blind overwrites.
- **Built-in agents are private** — Prompts bundled as code. Users invoke via CLI, not by editing prompts.

## License

MIT
