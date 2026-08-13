# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Wrangler** 是一个基于 pnpm 的 TypeScript monorepo —— 位于 [colts](https://github.com/agentskillmania/colts) ReAct 框架与可用智能体系统之间的抽象层。提供智能体/团队配置加载、`EnhancedRunner` 入口、技能管理和开发工具。

## 包

| 包                                                                  | 说明                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`@agentskillmania/wrangler`](./packages/wrangler/)                 | 核心库 —— 智能体与团队配置加载、`EnhancedRunner`、技能管理、工作空间组合和 MCP 工具集成 |
| [`@agentskillmania/wrangler-devtool`](./packages/wrangler-devtool/) | 开发工具包 —— 项目脚手架、评估框架、内置技能                                            |
| [`@agentskillmania/wrangler-daemon`](./packages/wrangler-daemon/)   | HTTP API 服务器 —— 通过 REST/SSE 暴露智能体会话、技能管理和 devtool 端点                |

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/agentskillmania/wrangler.git
cd wrangler
pnpm install

# 构建所有包
pnpm build

# 启动 HTTP API 服务器（暴露智能体会话 + devtool 端点）
npx wrangler-daemon
```

在你的项目目录放置 `wrangler.yaml`（或 `~/.agentskillmania/skill-studio/config.yaml`）：

```yaml
llm:
  providers:
    - name: openai
      apiKey: sk-your-key
      baseUrl: https://api.openai.com/v1 # 可选
      models:
        - modelId: gpt-4o
```

## 使用

### 从 `AGENT.md` 运行智能体

创建一个含 `AGENT.md` 的智能体目录（YAML frontmatter 定义 name/instructions，可选 `skills/` 和 `mcp.json`），然后：

```typescript
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { NodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';

// 1. 加载智能体定义（runtime 必传——引擎 core 零 Node 依赖）
const agent = await AgentLoader.loadFrom('./my-agent', new NodeHostEnv());

// 2. 创建 runner（llmClient 可以是任意 ILLMProvider，如 LLMClient.quickInit 或自定义）
const runner = await EnhancedRunner.create({
  runtime: new NodeHostEnv(), // 必传
  llm: { client: llmClient, model: 'gpt-4o' },
  workspacePath: process.cwd(),
  skills: { dirs: agent.skillDirs },
  tools: { mcpConfigPaths: agent.mcpPaths },
});

// 3. 运行 —— 事件经 runner.on(...) 实时流式输出，run() 阻塞返回最终结果
runner.on('tool:start', ({ action }) => console.log('tool:', action.tool));
runner.on('token', ({ token }) => process.stdout.write(token));

let state = createAgentState({ name: agent.name, instructions: agent.instructions, tools: [] });
state = addUserMessage(state, '请审查这个项目');
const { result } = await runner.run(state);
```

> **Node 专属能力均由宿主注入**：web 工具（`web_fetch`/`web_search`，jsdom 爬虫）在 `@agentskillmania/wrangler/tools/web`；MCP 加载在 `@agentskillmania/wrangler/tools/mcp`；sandbox 实例由宿主构造。完整接法见 [包 README](./packages/wrangler/README.zh_CN.md)。

### 从 `CREW.md` 运行团队

团队（crew）是配置层，不是独立运行时：`CrewLoader` 解析 `CREW.md` + `agents/*.md`，`crewToRunnerOptions()` 把它们转换成 `EnhancedRunner` 选项。主智能体作为普通智能体运行，其他智能体成为子代理，通过 `delegate` 工具调用（子代理继承父智能体的工具和技能）。

```typescript
import { CrewLoader, crewToRunnerOptions, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';

const crew = await new CrewLoader('./my-crew', new NodeHostEnv()).load();

const runner = await EnhancedRunner.create({
  ...crewToRunnerOptions(crew),
  runtime: new NodeHostEnv(), // 必传
  llm: { client: llmClient, model: 'gpt-4o' },
  workspacePath: process.cwd(),
});

let state = createAgentState({ name: crew.meta.primaryAgent, instructions: '', tools: [] });
state = addUserMessage(state, '调研这个选题并写一篇报道');
const { result } = await runner.run(state);
```

### `EnhancedRunner.create` 关键选项

| 选项                                                              | 含义                                                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `runtime`                                                         | **必传**宿主环境——Node：`new NodeHostEnv()`（子路径）；浏览器：基于 OPFS 的 HostEnv。主入口零 Node 导入     |
| `llm.client` / `llm.quickInit` + `quickInitFactory`               | LLM provider 注入，或快速初始化配置 + 宿主提供的创建器（如 `(p) => LLMClient.quickInit({ providers: p })`） |
| `systemPrompt`                                                    | 附加系统提示词（与内建时间头合并）                                                                          |
| `skills.dirs` / `skills.provider`                                 | 要扫描的技能目录；或注入的 `ISkillProvider`（如浏览器里基于 OPFS 的实现）                                   |
| `tools.deps`                                                      | 工具依赖（宿主 OS 访问）——注入，无 Node 默认                                                                |
| `tools.builtinFilter`                                             | 对平台无关 core 工具的白名单过滤                                                                            |
| `tools.inject` / `tools.injectFactory`                            | 宿主注入工具——web 工具经 `createWebTools`（子路径）接在这里                                                 |
| `tools.mcpConfigPaths` + `tools.mcpLoader`                        | MCP 配置路径 + 宿主注入的加载器（子路径 `tools/mcp`）                                                       |
| `sandbox.enabled` + `sandbox.instance`                            | 启用 WASM 沙箱 + 注入宿主构造的实例                                                                         |
| `thinking`、`session`、`commands`、`specPlan`、`todolist`、`a2ui` | 功能分组                                                                                                    |
| `subAgents`                                                       | 子代理配置（启用 `delegate` 工具）                                                                          |

## 使用 Devtool 开发

```bash
# 初始化项目（agent | crew | skill）
npx wrangler-devtool init --type agent ./my-agent
npx wrangler-devtool init --type crew ./my-crew

# 创建资源
npx wrangler-devtool create agent my-bot
npx wrangler-devtool create skill search-web
npx wrangler-devtool create crew dev-team

# 运行评估套件
npx wrangler-devtool eval evals/baseline.yaml
npx wrangler-devtool eval evals/baseline.yaml --runs 5 --reporter json
```

完整 CLI 参考见 [`wrangler-devtool` 文档](./packages/wrangler-devtool/README.md)。

## 开发

```bash
pnpm build              # 构建所有包
pnpm dev                # 监听模式
pnpm test:unit          # 仅单元测试
pnpm test:intg          # 集成测试（需要 .env 配置 API 密钥 + ENABLE_INTEGRATION_TESTS=true）
pnpm test:coverage      # 覆盖率报告（90% 阈值）
pnpm lint               # ESLint
pnpm lint:fix           # ESLint 自动修复
pnpm format:check       # Prettier 检查
pnpm changeset          # 创建变更集
pnpm release            # 构建 + 发布
```

## 架构

```
wrangler-daemon ──depends──► wrangler
wrangler-devtool ─depends──► wrangler
wrangler ────────depends──► colts, llm-client
```

Wrangler 构建在 colts 框架之上：

- **colts** 提供 ReAct 智能体运行器、执行引擎、子代理委派和事件原语
- **llm-client** 提供统一的大模型访问和并发控制
- **wrangler** 增加智能体加载（从 `AGENT.md`）、团队定义（从 `CREW.md`）、技能组合和 `EnhancedRunner`。团队是配置层而非运行时编排器 —— `CrewLoader.load()` 解析团队目录，`crewToRunnerOptions()` 将其转换为 `EnhancedRunner.create({ subAgents })` 的选项。`CREW.md` 正文注入主智能体的 system prompt，非主智能体成为可通过 colts `delegate` 工具调用的子代理。
- **wrangler-devtool** 提供构建、测试、评估智能体的开发工具
- **wrangler-daemon** 提供上层应用使用的 HTTP API 服务器

## 要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0（通过 `preinstall` 脚本强制）

## 许可证

MIT
