# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Wrangler** 是一个基于 pnpm 的 TypeScript  monorepo，提供智能体团队编排、技能管理、开发工具和交互式 TUI —— 是 [colts](https://github.com/agentskillmania/colts) ReAct 框架与可用多智能体系统之间的抽象层。

## 包

| 包 | 说明 |
|---------|-------------|
| [`@agentskillmania/wrangler`](./packages/wrangler/) | 核心库 —— 智能体团队编排、`EnhancedRunner`、技能管理、工作空间组合和 MCP 工具集成 |
| [`@agentskillmania/wrangler-cli`](./packages/wrangler-cli/) | 终端 UI（Ink + React）—— 交互式智能体聊天，支持流式输出、思考显示、设置向导和多会话支持 |
| [`@agentskillmania/wrangler-devtool`](./packages/wrangler-devtool/) | 开发工具包 —— 脚手架、声明式测试、AI 智能生成、质量评审和会话管理 |

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/agentskillmania/wrangler.git
cd wrangler
pnpm install

# 构建所有包
pnpm build

# 启动 TUI（首次运行会打开 LLM 配置设置向导）
npx wrangler .
```

设置向导会写入 `~/.agentskillmania/wrangler/config.yaml`。或者在你的项目目录中放置 `wrangler.yaml`：

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
wrangler-cli ────depends───► wrangler
wrangler-devtool ─depends──► wrangler
wrangler ────────depends──► colts, llm-client
```

Wrangler 构建在 colts 框架之上：

- **colts** 提供 ReAct 智能体运行器、执行引擎和流式原语
- **llm-client** 提供统一的大模型访问和并发控制
- **wrangler** 增加团队编排、智能体加载（从 `AGENT.md`）、团队定义（从 `CREW.md`）、技能组合和 `EnhancedRunner`
- **wrangler-cli** 提供交互式终端 UI
- **wrangler-devtool** 提供开发工具，用于构建、测试和评审智能体

## 要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0（通过 `preinstall` 脚本强制）

## 许可证

MIT
