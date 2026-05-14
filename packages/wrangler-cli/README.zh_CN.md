# @agentskillmania/wrangler-cli

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler-cli.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![English Documentation](https://img.shields.io/badge/docs-English-blue.svg)](./README.md)

Agent 对话与 Crew 管理的交互式终端 UI —— 基于 [Ink](https://github.com/vadimdemedes/ink)（React CLI 框架）构建。

## 功能特性

- **Setup Wizard** — 首次运行引导配置 LLM 提供商、API Key 和模型
- **流式对话** — 实时逐 Token 显示，带打字机效果
- **Thinking 显示** — 实时展示 Agent 的思维链（启用时）
- **目录模式检测** — 自动识别 Agent（`AGENT.md`）、Crew（`crew.yaml`）或裸模式
- **文件配置** — 支持 `./wrangler.yaml` 或 `~/.agentskillmania/wrangler/config.yaml`
- **内置命令** — `/help`、`/clear`、`/sessions`、`/session <name>`

## 安装

```bash
# 全局安装
pnpm add -g @agentskillmania/wrangler-cli

# 或通过 npx 使用
npx wrangler .
```

## 使用

```bash
# 在当前目录启动
wrangler .

# 在指定项目目录启动
wrangler /path/to/project
```

首次运行会打开配置向导。配置保存在 `~/.agentskillmania/wrangler/config.yaml`：

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
  baseUrl: https://api.openai.com/v1
```

### 模式检测

| 目录包含 | 模式 | 行为 |
|---------|------|------|
| `AGENT.md` | Agent | 加载 Agent 定义、指令和 Skills |
| `crew.yaml` / `CREW.md` | Crew | 加载包含多 Agent 的 Crew |
| 均无 | 裸模式 | 使用默认助手，无特殊指令 |

## 架构

```
index.ts → detectMode() + loadConfig() → render(App)
  App → SetupWizard（无配置）| MainTUI（有效配置）
  MainTUI → TimelinePanel + InputBar + StatusBar
  useAgent → EnhancedRunner.runStream() → StreamConsumer → TimelineEntry[]
```

## 依赖

- [`@agentskillmania/wrangler`](../wrangler/) — 核心编排库
- `ink` + `react` — 终端 UI 框架
- `@inkjs/ui` — Ink UI 组件（TextInput、Select）

## License

MIT
