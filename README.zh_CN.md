# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Wrangler** 是一个基于 pnpm 的 TypeScript  monorepo，提供智能体配置、多智能体团队、技能管理和开发工具 —— 是 [colts](https://github.com/agentskillmania/colts) ReAct 框架与可用多智能体系统之间的抽象层。

## 包

| 包 | 说明 |
|---------|-------------|
| [`@agentskillmania/wrangler`](./packages/wrangler/) | 核心库 —— 智能体与团队配置加载、`EnhancedRunner`、技能管理、工作空间组合和 MCP 工具集成 |
| [`@agentskillmania/wrangler-devtool`](./packages/wrangler-devtool/) | 开发工具包 —— 项目脚手架、评估框架、内置技能 |
| [`@agentskillmania/wrangler-daemon`](./packages/wrangler-daemon/) | HTTP API 服务器 —— 通过 REST/SSE 暴露智能体会话、技能管理和 devtool 端点 |

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

在你的项目目录放置 `wrangler.yaml`（或 `~/.agentskillmania/wrangler/config.yaml`）：

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
  baseUrl: https://api.openai.com/v1  # 可选
```

## 使用 Devtool 开发

```bash
# 初始化 agent 项目
npx wrangler-devtool init --mode agent ./my-agent

# 用 AI 生成 agent
npx wrangler-devtool agent write --prompt "你是一个资深 React 开发者"

# 运行测试
npx wrangler-devtool test ./my-agent

# 质量评审
npx wrangler-devtool review ./my-agent --deep
```

完整 CLI 参考见 [`wrangler-devtool` 文档](./packages/wrangler-devtool/)。

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
- **wrangler** 增加智能体加载（从 `AGENT.md`）、团队定义（从 `CREW.md`）、技能组合和 `EnhancedRunner`。团队不再是运行时编排器 —— `CrewLoader.load()` 解析团队目录，`crewToRunnerOptions()` 将其转换为 `EnhancedRunner.create({ subAgents })` 的选项。`CREW.md` 正文注入主智能体的 system prompt，非主智能体成为可通过 colts `delegate` 工具调用的子代理。
- **wrangler-devtool** 提供构建、测试、评估智能体的开发工具
- **wrangler-daemon** 提供上层应用使用的 HTTP API 服务器

## 要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0（通过 `preinstall` 脚本强制）

## 许可证

MIT
