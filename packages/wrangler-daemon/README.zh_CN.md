# @agentskillmania/wrangler-daemon

[English Documentation](./README.md)

agentskillmania 技术栈的 HTTP 服务 + Playground 界面。用会话化的 HTTP API、SSE 流式传输和内置 Web UI 包装 [`@agentskillmania/wrangler`](../wrangler) 的 `AgentHarness`，支持与 Agent 和团队对话。

## 它能做什么

- **Agent 对话** —— `POST /api/agents/:name/chat` 根据 `AGENT.md` 定义启动新会话。本轮在常驻 events 流（`GET /api/chat/:id/events`）上观察——token、思考、工具调用、技能、子代理委托、投递——直到 `done`。
- **团队对话** —— `POST /api/crews/:id/chat` 根据团队目录（`CREW.md` + `agents/*.md`）启动会话。主 Agent 成为 Runner，其余 Agent 成为可通过 `delegate` 工具调用的子代理。团队会话打上 `crewId` 标记以便正确恢复。
- **会话恢复** —— `POST /api/chat/:sessionId` 继续已有会话。Daemon 通过 `meta.runnerConfig.crewId` 检测团队会话并自动重载团队配置以重建子代理。
- **资源 CRUD** —— Agent、技能、团队存储在磁盘 `~/.agentskillmania/skill-studio/{agents,skills,crews}/` 下，通过 REST 端点管理。
- **Playground** —— Preact 单页应用，三列聊天布局、配置面板、座舱事件日志、Agent 状态检查器、文件浏览器。团队对话有独立的 `#crew-chat` 路由，实时渲染子代理事件（token/思考/工具）。
- **Devtool 端点** —— 项目脚手架（`init --type agent|crew|skill`）、结构化文件变更、评估套件运行器。

## 快速开始

```bash
# 构建所有包（在 wrangler 仓库根目录运行）
pnpm install
pnpm run build

# 前台启动 daemon
node packages/wrangler-daemon/dist/daemon.js

# 或通过 CLI
npx wrangler-daemon start    # 后台运行，PID 写入 ~/.agentskillmania/skill-studio/daemon.pid
wrangler-daemon status
wrangler-daemon stop
```

Daemon 默认监听 `localhost:3100`。浏览器打开 `http://localhost:3100/` 进入 Playground。

## 配置

Daemon 启动时读取 `~/.agentskillmania/skill-studio/config.yaml`：

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

资源与配置同目录：

```
~/.agentskillmania/skill-studio/
├── config.yaml     # LLM + 服务配置
├── agents/         # <id>/AGENT.md
├── skills/         # <id>/SKILL.md
├── crews/          # <id>/CREW.md + <id>/agents/*.md
└── sessions/       # <workspaceHash>/<sessionId>/{meta.yaml, state.json, entries.jsonl}
```

## HTTP API

### 对话

会话通过**常驻 events 流**观察；发消息返回 **ack**，帧从流上到达（0.3.0 协议，迁移说明见下）。

| 方法   | 路径                                    | 用途                                                                              |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------- |
| `POST` | `/api/agents/:name/chat`                | 启动新的 Agent 对话                                                               |
| `POST` | `/api/crews/:id/chat`                   | 启动新的团队对话                                                                  |
| `POST` | `/api/chat/:sessionId`                  | 向既有会话发消息 → **JSON ack**                                                   |
| `GET`  | `/api/chat/:sessionId/events?lastSeq=N` | **常驻 SSE 流**（帧携带 `seq`）                                                   |
| `POST` | `/api/chat/:sessionId/stop`             | 中止当前运行                                                                      |
| `POST` | `/api/chat/:sessionId/respond`          | 响应 `ask_human` 提示                                                             |
| `POST` | `/api/chat/:sessionId/truncate`         | 按轮截断（`{ "keepTurns": N }`）——编辑重发/重新生成/回退/Fork 共用                |
| `GET`  | `/api/chat/:sessionId/messages`         | 已持久化的消息历史（notebook 目录会话用 `?sessionDir=`）                          |
| `GET`  | `/api/chat/commands`                    | 预定义的斜杠命令（供 UI 使用）                                                    |
| `GET`  | `/api/env`                              | 宿主自省（版本、app 目录、agents/skills/crews/sessions 目录、pid 路径——不含凭据） |

新会话请求体（`/api/agents/:name/chat` 和 `/api/crews/:id/chat`）：

```jsonc
{
  "message": "工作区里有哪些文件？",
  "workspacePath": "/abs/path/to/project",
  "sessionId": "可选，客户端指定 ID",
  "thinkingEnabled": false,
  "model": "glm-4", // 可选，按请求覆盖
  "subAgents": [
    // 可选：内联子 agent（无需建 crew 目录）
    { "name": "researcher", "instructions": "做调研" },
  ],
  "config": {
    // 可选的 Runner 配置（结构化配置组）
    "skills": { "dirs": ["./skills"] },
    "tools": {
      "mcpConfigPaths": ["./mcp.json"],
      "builtinFilter": { "shell": true, "file_read": true },
    },
    "sandbox": true, // 或 { "enabled": true, "timeout": 600000, ... }
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

#### 发送与事件流配合

```js
// 1) 先挂常驻流（重连时带上你见过的最大 seq）。
const events = await fetch(`/api/chat/${sid}/events?lastSeq=${lastSeq}`);
// 帧的 data 携带 { seq, ...事件字段 }

// 2) 发消息——返回你要等待的那一轮。
const ack = await fetch(`/api/chat/${sid}`, {
  method: 'POST',
  body: JSON.stringify({ message }),
}).then((r) => r.json()); // { ok, sessionId, turnSeq }

// 3) 回答在 events 流上；data.turnSeq === ack.turnSeq 的那条 done 帧即本轮完结。
```

- 每帧的 `data.seq` 会话内单调：`seq <= lastSeq` 丢弃（去重）、`> lastSeq` 应用（补洞）——断线重连不丢帧不重帧。
- 重放段结束后流上发一条 `history-end` 分界帧 `{ firstSeq, lastSeq }`：`lastSeq` 倒退=会话被驱逐重建（seq 空间重启）；`firstSeq` 跳变=最旧的帧被裁掉。
- 挂着流时会话被驱逐 → 收到 `session-evicted` 后流关闭，需连新会话。
- **ack 之后的错误**（LLM/工具失败）以 `error` 帧到达流上，不在 POST 响应里。
- `POST /api/chat/:id` 加 `?stream=1` 保持旧「发消息即流」形状（响应头 `Deprecation: true`），后续 minor 移除。

常驻流上的事件：`session-start`、`token`、`thinking`、`tool-start`、`tool-end`、`skill-start`、`skill-end`、`subagent-start`、`subagent-token`、`subagent-thinking`、`subagent-tool-start`、`subagent-tool-end`、`subagent-end`、`step-start`、`step-end`、`phase-change`、`llm-request`、`llm-response`、`compressing`、`compressed`、`waiting-human`、`human-input`、`human-input-resolved`、`delivery`、`session-title`、`session-cleared`、`history-end`、`session-evicted`、`error`、`done`。

#### 委派是异步的

会话配了子 agent（crew，或内联 `subAgents`）时，`delegate` 工具**受理即返回**回执（`{ status: "accepted", subtaskId, agent, task, message }`）而非结果。子 agent 在后台跑；完成后 daemon 把投递写进会话邮箱并发 `delivery` 帧，随后由消费轮把结果喂回主 agent。等 `delivery` 帧（或下一条 `done`），不要等工具结果。

### 会话

| 方法     | 路径                     | 用途                                    |
| -------- | ------------------------ | --------------------------------------- |
| `GET`    | `/api/sessions`          | 列出会话（可选 `?workspacePath=` 过滤） |
| `GET`    | `/api/sessions/:id`      | 会话元数据                              |
| `DELETE` | `/api/sessions/:id`      | 删除会话（停止活动运行 + 移除磁盘文件） |
| `POST`   | `/api/sessions/:id/fork` | 复制会话                                |

### Agent

| 方法                        | 路径                   | 用途                                   |
| --------------------------- | ---------------------- | -------------------------------------- |
| `GET`                       | `/api/agents`          | 列出 Agent                             |
| `GET`                       | `/api/agents/:id`      | Agent 详情（解析后的 AGENT.md）        |
| `POST`                      | `/api/agents`          | 创建 Agent                             |
| `DELETE`                    | `/api/agents/:id`      | 删除 Agent                             |
| `GET`/`PUT`/`POST`/`DELETE` | `/api/agents/:id/file` | 在 Agent 目录内读取/写入/创建/删除文件 |

### 团队

| 方法                        | 路径                  | 用途                                      |
| --------------------------- | --------------------- | ----------------------------------------- |
| `GET`                       | `/api/crews`          | 列出团队                                  |
| `GET`                       | `/api/crews/:id`      | 团队详情（解析后的 CREW.md + Agent 列表） |
| `POST`                      | `/api/crews`          | 创建团队                                  |
| `DELETE`                    | `/api/crews/:id`      | 删除团队                                  |
| `GET`/`PUT`/`POST`/`DELETE` | `/api/crews/:id/file` | 团队目录内的文件操作                      |

### 技能

结构与 Agent 相同：`/api/skills`、`/api/skills/:id`、`/api/skills/:id/file`。

### 工作区文件（按会话）

| 方法  | 路径                                  | 用途               |
| ----- | ------------------------------------- | ------------------ |
| `GET` | `/api/files/:sessionId/tree`          | 会话工作区的文件树 |
| `GET` | `/api/files/:sessionId/content?path=` | 读取文件           |
| `PUT` | `/api/files/:sessionId/content`       | 写入文件           |

### Agent 状态（座舱 SSE）

| 方法  | 路径                          | 用途                           |
| ----- | ----------------------------- | ------------------------------ |
| `GET` | `/api/agent/:sessionId/state` | Agent 诊断 + 事件日志的 SSE 流 |

### Spec 和 Plan

| 方法         | 路径                                            | 用途           |
| ------------ | ----------------------------------------------- | -------------- |
| `GET`/`POST` | `/api/specs`                                    | 列出/创建 Spec |
| `GET`/`PUT`  | `/api/specs/:name/:version`                     | 读取/更新 Spec |
| `POST`       | `/api/specs/:name/:version/status`              | 更新 Spec 状态 |
| `GET`/`POST` | `/api/plans`                                    | 列出/创建 Plan |
| `GET`/`PUT`  | `/api/plans/:name/:specVersion/:version`        | 读取/更新 Plan |
| `POST`       | `/api/plans/:name/:specVersion/:version/status` | 更新 Plan 状态 |

### 模型

| 方法  | 路径                            | 用途                                           |
| ----- | ------------------------------- | ---------------------------------------------- |
| `GET` | `/api/models/:modelId/metadata` | 模型元数据（上下文窗口、最大 token、推理能力） |

### Devtool

| 方法   | 路径                         | 用途                                 |
| ------ | ---------------------------- | ------------------------------------ |
| `POST` | `/api/devtool/project/init`  | 创建项目脚手架（`type: agent         | crew | skill`） |
| `POST` | `/api/devtool/template`      | 渲染模板（agent/skill/crew/session） |
| `POST` | `/api/devtool/changes/apply` | 应用结构化文件变更                   |
| `POST` | `/api/devtool/eval/run`      | 运行评估套件                         |

### 配置与健康检查

| 方法        | 路径              | 用途                      |
| ----------- | ----------------- | ------------------------- |
| `GET`/`PUT` | `/api/config`     | 读取/更新 Daemon 配置     |
| `GET`/`PUT` | `/api/config/raw` | 读取/写入原始 config.yaml |
| `GET`       | `/api/health`     | 健康检查                  |
| `GET`       | `/api/launcher`   | 工作区启动器数据          |

## Playground 界面

Daemon 从 `/` 提供 Preact 单页应用。页面：

- **Chat**（`#chat`）—— Agent 对话，含 Runner 配置、模型选择器、AskHuman 桥接。
- **Crew Chat**（`#crew-chat`）—— 团队对话，镜像 Agent 布局，子代理事件（token/思考/工具）内联渲染。子代理 token 按代理名命名空间化，避免多个并发工作体互相干扰。
- **Agents / Skills / Crews** —— CRUD 页面，含内联文件编辑器。
- **Sessions** —— 列出、复制、删除。
- **State** —— 实时 Agent 状态检查器（座舱 SSE）。
- **Files** —— 工作区文件浏览器 + 编辑器。
- **Specs / Plans** —— Spec/Plan 管理。
- **Config** —— Daemon 配置编辑器。

## 架构

```
HTTP 请求
  → Fastify 路由（routes/*.ts）
    → ResourceManager（从磁盘加载 AGENT.md / CREW.md）
    → AgentSession.create / .resume（包装 AgentHarness）
      → AgentHarness.create({ llm, skills, delegation, crewId, ... })
        → colts AgentRunner（ReAct 循环，EventEmitter）
    → SSE 流（AgentSession.handleMessage → reply.raw）
```

Daemon 跨重启无状态：会话持久化在磁盘上（`meta.yaml` + `state.json` + `entries.jsonl`），内存中的 `activeSessions` 映射在重启后首次恢复时按需重建。

## 依赖

- [`@agentskillmania/wrangler`](../wrangler) —— AgentHarness、CrewLoader、AgentLoader、SessionStore
- [`@agentskillmania/wrangler-devtool`](../wrangler-devtool) —— 脚手架、文件变更、评估框架、内置技能
- [`@agentskillmania/colts`](https://github.com/agentskillmania/colts) —— ReAct Agent 框架
- [`fastify`](https://fastify.dev) —— HTTP 服务

## License

MIT
