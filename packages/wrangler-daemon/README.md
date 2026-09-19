# @agentskillmania/wrangler-daemon

[中文文档](./README.zh_CN.md)

HTTP server + Playground UI for the agentskillmania stack. Wraps [`@agentskillmania/wrangler`](../wrangler)'s `AgentHarness` with a session-aware HTTP API, SSE streaming, and a built-in web UI for chatting with agents and crews.

## What it does

- **Agent chat** — `POST /api/agents/:name/chat` starts a new conversation driven by an `AGENT.md` definition. The turn is observed on the persistent events stream (`GET /api/chat/:id/events`) — token, thinking, tool calls, skills, sub-agent delegation, deliveries — until `done`.
- **Crew chat** — `POST /api/crews/:id/chat` starts a conversation driven by a crew directory (`CREW.md` + `agents/*.md`). The primary agent becomes the runner; other agents become sub-agents reachable via the `delegate` tool. Crew sessions are tagged with `crewId` so they can be resumed correctly.
- **Session resume** — `POST /api/chat/:sessionId` continues an existing conversation. The daemon detects crew sessions via `meta.runnerConfig.crewId` and automatically reloads the crew config to rebuild sub-agents.
- **Resource CRUD** — agents, skills, and crews are stored on disk under `~/.agentskillmania/skill-studio/{agents,skills,crews}/` and managed via REST endpoints.
- **Playground** — a Preact single-page app served at `/` with three-column chat layout, config panel, cockpit event log, agent state inspector, and file browser. Crew chat has a dedicated `#crew-chat` route that renders sub-agent events (token/thinking/tool) as they stream.
- **Devtool endpoints** — project scaffolding (`init --type agent|crew|skill`), structured file changes, and eval-suite runner.

## Quick start

```bash
# Build all packages (run from wrangler repo root)
pnpm install
pnpm run build

# Start the daemon (foreground)
node packages/wrangler-daemon/dist/daemon.js

# Or via CLI
npx wrangler-daemon start    # background, writes PID to ~/.agentskillmania/skill-studio/daemon.pid
wrangler-daemon status
wrangler-daemon stop
```

The daemon listens on `localhost:3100` by default. Open `http://localhost:3100/` in a browser for the Playground.

## Configuration

The daemon reads `~/.agentskillmania/skill-studio/config.yaml` at startup:

```yaml
llm:
  providers:
    - name: openai
      apiKey: your-key
      baseUrl: https://open.bigmodel.cn/api/coding/paas/v4
      models:
        - modelId: glm-5.1
server:
  port: 3100
  host: localhost
```

Resources live alongside the config:

```
~/.agentskillmania/skill-studio/
├── config.yaml     # LLM + server config
├── agents/         # <id>/AGENT.md
├── skills/         # <id>/SKILL.md
├── crews/          # <id>/CREW.md + <id>/agents/*.md
└── sessions/       # <workspaceHash>/<sessionId>/{meta.yaml, state.json, entries.jsonl}
```

## HTTP API

### Chat

Sessions are observed through a **persistent events stream**; sending a message returns an **ack** and the frames arrive on that stream (0.3.0 protocol — see the migration note below).

| Method | Path                                    | Purpose                                                                                               |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST` | `/api/agents/:name/chat`                | Start a new agent conversation                                                                        |
| `POST` | `/api/crews/:id/chat`                   | Start a new crew conversation                                                                         |
| `POST` | `/api/chat/:sessionId`                  | Send a message to an existing session → **JSON ack**                                                  |
| `GET`  | `/api/chat/:sessionId/events?lastSeq=N` | **Persistent SSE stream** (frames carry `seq`)                                                        |
| `POST` | `/api/chat/:sessionId/stop`             | Abort the active run                                                                                  |
| `POST` | `/api/chat/:sessionId/respond`          | Respond to an `ask_human` prompt                                                                      |
| `POST` | `/api/chat/:sessionId/truncate`         | Truncate by turn (`{ "keepTurns": N }`) — shared by edit-resend / regenerate / rewind / fork          |
| `GET`  | `/api/chat/:sessionId/messages`         | Persisted message history (`?sessionDir=` for notebook-dir sessions)                                  |
| `GET`  | `/api/chat/commands`                    | Predefined slash commands for the UI                                                                  |
| `GET`  | `/api/env`                              | Host self-inspection (version, app dir, agents/skills/crews/sessions dirs, pid path — no credentials) |

New conversation body (`/api/agents/:name/chat` and `/api/crews/:id/chat`):

```jsonc
{
  "message": "What files are in this workspace?",
  "workspacePath": "/abs/path/to/project",
  "sessionId": "optional-client-id",
  "thinkingEnabled": false,
  "model": "glm-4", // optional per-request override
  "subAgents": [
    // optional inline sub-agents (no crew dir needed)
    { "name": "researcher", "instructions": "research things" },
  ],
  "config": {
    // optional runner config (structured groups)
    "skills": { "dirs": ["./skills"] },
    "tools": {
      "mcpConfigPaths": ["./mcp.json"],
      "builtinFilter": { "shell": true, "file_read": true },
    },
    "sandbox": true, // or { "enabled": true, "timeout": 600000, ... }
    "thinking": { "enabled": false },
    "session": { "enabled": true },
    "todolist": { "enabled": true },
    "specPlan": { "enabled": true },
    "commands": { "enabled": true },
    "a2ui": { "enabled": false },
    "limits": { "maxSteps": 500, "requestTimeout": 1800000 },
    "search": { "provider": "sogou" },
    "compression": { "enabled": true, "strategy": "summarize", "threshold": 120 },
  },
}
```

#### Send + events flow

```js
// 1) Open the persistent stream first (reconnect with the last seq you saw).
const events = await fetch(`/api/chat/${sid}/events?lastSeq=${lastSeq}`);
// frames: data carries { seq, ...eventFields }

// 2) Send — resolves with the turn you should wait for.
const ack = await fetch(`/api/chat/${sid}`, {
  method: 'POST',
  body: JSON.stringify({ message }),
}).then((r) => r.json()); // { ok, sessionId, turnSeq }

// 3) The answer streams on the events stream; the turn is complete at the `done`
//    frame whose data.turnSeq === ack.turnSeq.
```

- Every streamed frame's `data.seq` is monotonic per session: drop `seq <= lastSeq` (dedup), apply `seq > lastSeq` (fill the gap) — reconnecting never loses or repeats a frame.
- After replay, the stream emits a `history-end` divider `{ firstSeq, lastSeq }`: if `lastSeq` moved backwards the session was evicted and rebuilt (seq space restarted); a `firstSeq` jump means the oldest frames were trimmed.
- If the session is evicted while you are attached, the stream sends `session-evicted` and closes — reconnect to a fresh session.
- **Errors after the ack** (LLM/tool failures) arrive as `error` frames on the stream, not on the POST response.
- `?stream=1` on `POST /api/chat/:id` keeps the legacy "send-and-stream" shape (response header `Deprecation: true`); it will be removed in a later minor.

Events streamed on the persistent stream: `session-start`, `token`, `thinking`, `tool-start`, `tool-end`, `skill-start`, `skill-end`, `subagent-start`, `subagent-token`, `subagent-thinking`, `subagent-tool-start`, `subagent-tool-end`, `subagent-end`, `step-start`, `step-end`, `phase-change`, `llm-request`, `llm-response`, `compressing`, `compressed`, `waiting-human`, `human-input`, `human-input-resolved`, `delivery`, `session-title`, `session-cleared`, `history-end`, `session-evicted`, `error`, `done`.

#### Delegation is asynchronous

When a session has sub-agents (`crew`, or inline `subAgents`), the `delegate` tool **accepts** the task immediately and returns a receipt (`{ status: "accepted", subtaskId, agent, task, message }`) instead of the result. The sub-agent runs in the background; on completion the daemon writes a delivery into the session mailbox and emits a `delivery` frame, then a consumption turn feeds the result back to the parent. Wait for the `delivery` frame (or the next `done`), not for the tool result.

### Sessions

| Method   | Path                     | Purpose                                           |
| -------- | ------------------------ | ------------------------------------------------- |
| `GET`    | `/api/sessions`          | List sessions (optional `?workspacePath=` filter) |
| `GET`    | `/api/sessions/:id`      | Session metadata                                  |
| `DELETE` | `/api/sessions/:id`      | Delete session (stops active run + removes disk)  |
| `POST`   | `/api/sessions/:id/fork` | Duplicate a session                               |

### Agents

| Method                      | Path                   | Purpose                                         |
| --------------------------- | ---------------------- | ----------------------------------------------- |
| `GET`                       | `/api/agents`          | List agents                                     |
| `GET`                       | `/api/agents/:id`      | Agent detail (parsed AGENT.md)                  |
| `POST`                      | `/api/agents`          | Create agent                                    |
| `DELETE`                    | `/api/agents/:id`      | Delete agent                                    |
| `GET`/`PUT`/`POST`/`DELETE` | `/api/agents/:id/file` | Read/write/create/delete files inside agent dir |

### Crews

| Method                      | Path                  | Purpose                                       |
| --------------------------- | --------------------- | --------------------------------------------- |
| `GET`                       | `/api/crews`          | List crews                                    |
| `GET`                       | `/api/crews/:id`      | Crew detail (parsed CREW.md + agents listing) |
| `POST`                      | `/api/crews`          | Create crew                                   |
| `DELETE`                    | `/api/crews/:id`      | Delete crew                                   |
| `GET`/`PUT`/`POST`/`DELETE` | `/api/crews/:id/file` | File ops inside crew dir                      |

### Skills

Same shape as agents: `/api/skills`, `/api/skills/:id`, `/api/skills/:id/file`.

### Workspace files (per-session)

| Method | Path                                  | Purpose                              |
| ------ | ------------------------------------- | ------------------------------------ |
| `GET`  | `/api/files/:sessionId/tree`          | File tree of the session's workspace |
| `GET`  | `/api/files/:sessionId/content?path=` | Read a file                          |
| `PUT`  | `/api/files/:sessionId/content`       | Write a file                         |

### Agent state (cockpit SSE)

| Method | Path                          | Purpose                                     |
| ------ | ----------------------------- | ------------------------------------------- |
| `GET`  | `/api/agent/:sessionId/state` | SSE stream of agent diagnostics + event log |

### Specs & plans

| Method       | Path                                            | Purpose            |
| ------------ | ----------------------------------------------- | ------------------ |
| `GET`/`POST` | `/api/specs`                                    | List/create specs  |
| `GET`/`PUT`  | `/api/specs/:name/:version`                     | Read/update a spec |
| `POST`       | `/api/specs/:name/:version/status`              | Update spec status |
| `GET`/`POST` | `/api/plans`                                    | List/create plans  |
| `GET`/`PUT`  | `/api/plans/:name/:specVersion/:version`        | Read/update a plan |
| `POST`       | `/api/plans/:name/:specVersion/:version/status` | Update plan status |

### Models

| Method | Path                            | Purpose                                                |
| ------ | ------------------------------- | ------------------------------------------------------ |
| `GET`  | `/api/models/:modelId/metadata` | Model metadata (context window, max tokens, reasoning) |

### Devtool

| Method | Path                         | Purpose                                      |
| ------ | ---------------------------- | -------------------------------------------- |
| `POST` | `/api/devtool/project/init`  | Scaffold a project (`type: agent             | crew | skill`) |
| `POST` | `/api/devtool/template`      | Render a template (agent/skill/crew/session) |
| `POST` | `/api/devtool/changes/apply` | Apply structured file changes                |
| `POST` | `/api/devtool/eval/run`      | Run an eval suite                            |

### Config & health

| Method      | Path              | Purpose                    |
| ----------- | ----------------- | -------------------------- |
| `GET`/`PUT` | `/api/config`     | Read/update daemon config  |
| `GET`/`PUT` | `/api/config/raw` | Read/write raw config.yaml |
| `GET`       | `/api/health`     | Health check               |
| `GET`       | `/api/launcher`   | Workspace launcher data    |

## Playground UI

The daemon serves a Preact SPA from `/`. Pages:

- **Chat** (`#chat`) — agent chat with runner config, model selector, AskHuman bridging.
- **Crew Chat** (`#crew-chat`) — crew chat mirroring the agent layout, with sub-agent events (token/thinking/tool) rendered inline. Sub-agent tokens are namespaced per agent name so concurrent workers don't tangle.
- **Agents / Skills / Crews** — CRUD pages with inline file editors.
- **Sessions** — list, fork, delete.
- **State** — live agent state inspector (cockpit SSE).
- **Files** — workspace file browser + editor.
- **Specs / Plans** — spec/plan management.
- **Config** — daemon config editor.

## Architecture

```
HTTP request
  → Fastify route (routes/*.ts)
    → ResourceManager (loads AGENT.md / CREW.md from disk)
    → AgentSession.create / .resume (wraps AgentHarness)
      → AgentHarness.create({ llm, skills, delegation, crewId, ... })
        → colts AgentRunner (ReAct loop, EventEmitter)
    → SSE stream (AgentSession.handleMessage → reply.raw)
```

The daemon is stateless across restarts: sessions are persisted on disk (`meta.yaml` + `state.json` + `entries.jsonl`), and the in-memory `activeSessions` map is rebuilt lazily on first resume after restart.

## Dependencies

- [`@agentskillmania/wrangler`](../wrangler) — AgentHarness, CrewLoader, AgentLoader, SessionStore
- [`@agentskillmania/wrangler-devtool`](../wrangler-devtool) — scaffolding, file changes, eval framework, built-in skills
- [`@agentskillmania/colts`](https://github.com/agentskillmania/colts) — ReAct agent framework
- [`fastify`](https://fastify.dev) — HTTP server

## License

MIT
