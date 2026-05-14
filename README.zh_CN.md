# @agentskillmania/wrangler

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

**Wrangler** 是一个基于 pnpm 的 TypeScript monorepo，提供 Agent Crew 编排、Skill 管理和交互式 TUI —— 是 [colts](https://github.com/agentskillmania/colts) ReAct 框架与可用多 Agent 系统之间的抽象层。

## 包列表

| 包 | 描述 |
|---------|-------------|
| [`@agentskillmania/wrangler`](./packages/wrangler/) | 核心库 — Agent Crew 编排、`EnhancedRunner`、Skill 管理、Workspace 组合、MCP 工具集成 |
| [`@agentskillmania/wrangler-cli`](./packages/wrangler-cli/) | 终端 TUI（Ink + React）— 交互式 Agent 对话、流式输出与 Thinking 显示、Setup Wizard、多 Session 管理 |
| [`@agentskillmania/wrangler-devtool`](./packages/wrangler-devtool/) | 开发工具与辅助函数 |

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/agentskillmania/wrangler.git
cd wrangler
pnpm install

# 构建所有包
pnpm build

# 启动 TUI（首次运行会打开 LLM 配置向导）
npx wrangler .
```

配置向导会将配置写入 `~/.agentskillmania/wrangler/config.yaml`。也可以在项目目录下放置 `wrangler.yaml`：

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
  baseUrl: https://api.openai.com/v1  # 可选
```

## 开发

```bash
pnpm build              # 构建所有包
pnpm dev                # 监听模式
pnpm test:unit          # 仅运行单元测试
pnpm test:intg          # 仅运行集成测试（需要 .env 配置 API 密钥 + ENABLE_INTEGRATION_TESTS=true）
pnpm test:coverage      # 生成覆盖率报告（90% 阈值）
pnpm lint               # ESLint 检查
pnpm lint:fix           # ESLint 自动修复
pnpm format:check       # Prettier 格式检查
pnpm changeset          # 创建变更集
pnpm release            # 构建 + 发布
```

## 架构

```
wrangler-cli ────依赖───► wrangler
wrangler-devtool ─依赖──► wrangler
wrangler ────────依赖──► colts, llm-client
```

Wrangler 构建在 colts 框架之上：

- **colts** 提供 ReAct Agent Runner、执行引擎和流式输出原语
- **llm-client** 提供统一 LLM 访问与并发控制
- **wrangler** 在此基础上添加 Crew 编排、Agent 加载（从 `AGENT.md`）、Crew 定义（从 `crew.yaml`）、Skill 组合和 `EnhancedRunner`
- **wrangler-cli** 提供终端交互界面

## 环境要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 9.0.0（通过 `preinstall` 脚本强制使用）

## License

MIT
