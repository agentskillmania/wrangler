# @agentskillmania/wrangler-cli

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler-cli.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Interactive terminal UI for agent chat and crew management — built with [Ink](https://github.com/vadimdemedes/ink) (React for CLI).

## Features

- **Setup Wizard** — first-run guided setup for LLM provider, API key, and model
- **Streaming chat** — real-time token-by-token display with typewriter effect
- **Thinking display** — shows agent's chain-of-thought in real time (when enabled)
- **Directory-based mode detection** — auto-detects agent (`AGENT.md`), crew (`crew.yaml`), or bare mode
- **File-based config** — `./wrangler.yaml` or `~/.agentskillmania/wrangler/config.yaml`
- **Commands** — `/help`, `/clear`, `/sessions`, `/session <name>` built-in commands

## Installation

```bash
# Global install
pnpm add -g @agentskillmania/wrangler-cli

# Or use with npx
npx wrangler .
```

## Usage

```bash
# Start in current directory
wrangler .

# Start in a specific project directory
wrangler /path/to/project
```

First run opens a setup wizard. Configuration is saved to `~/.agentskillmania/wrangler/config.yaml`:

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
  baseUrl: https://api.openai.com/v1
```

### Mode Detection

| Directory contains | Mode | Behavior |
|-------------------|------|----------|
| `AGENT.md` | Agent | Loads agent definition, instructions, and skills |
| `crew.yaml` / `CREW.md` | Crew | Loads crew with multiple agents |
| Neither | Bare | Default assistant with no special instructions |

## Architecture

```
index.ts → detectMode() + loadConfig() → render(App)
  App → SetupWizard (no config) | MainTUI (valid config)
  MainTUI → TimelinePanel + InputBar + StatusBar
  useAgent → EnhancedRunner.runStream() → StreamConsumer → TimelineEntry[]
```

## Dependencies

- [`@agentskillmania/wrangler`](./packages/wrangler/) — Core orchestration library
- `ink` + `react` — Terminal UI framework
- `@inkjs/ui` — Ink UI components (TextInput, Select)

## License

MIT
