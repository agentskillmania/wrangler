# @agentskillmania/wrangler-devtool

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler-devtool.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler-devtool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Wrangler Devtool** 是 Wrangler 生态系统的开发工具包，提供脚手架、测试、评审和会话管理功能。

## 功能

### 脚手架

初始化工作空间并生成 agent/skill/crew 定义。

```bash
# 初始化工作空间
wrangler-devtool init --mode agent ./my-agent
wrangler-devtool init --mode crew ./my-crew

# 生成空模板
wrangler-devtool agent create coder
wrangler-devtool skill create writing
wrangler-devtool crew create research
```

### AI 智能生成

内置智能体通过自然语言提示生成或修改定义。

```bash
# 用 AI 生成 agent
wrangler-devtool agent write --prompt "你是一个资深 React 开发者"

# 修改现有 agent
wrangler-devtool agent write coder --prompt "增加 TypeScript 支持"

# 生成 skill
wrangler-devtool skill write --prompt "处理用户退款请求"

# 生成 crew
wrangler-devtool crew write --prompt "一个研究员和一个写手协作"
```

**安全性：** 变更使用结构化 `old → new` 格式，必须匹配原内容才能写入。默认 `--dry-run`，需要 `--apply` 才写入。

### 测试

基于 YAML 的声明式测试框架。

```bash
# 运行所有测试
wrangler-devtool test ./my-agent

# 运行单个用例
wrangler-devtool test ./my-agent --case "basic-math"

# 跳过软评价（更快）
wrangler-devtool test ./my-agent --hard-only

# JSON 输出
wrangler-devtool test ./my-agent --reporter json
```

**测试用例格式 (`test/*.yaml`)：**

```yaml
name: 基本数学
description: 验证 agent 能计算

input:
  message: "计算 23 * 47"

expected:
  hard:
    - type: output_contains
      value: "1081"
    - type: tool_called
      tool: shell
  soft:
    - name: 回答是否礼貌
      criteria: 评价回答是否礼貌专业。
      rubric:
        - score: 1
          description: "粗鲁或攻击性"
        - score: 5
          description: "友好且专业"
      minScore: 4
```

### 评审

对 agent/skill/crew 定义进行只读质量评审。

```bash
# 仅静态检查
wrangler-devtool review ./my-agent

# 深度 LLM 评审
wrangler-devtool review ./my-agent --deep

# 关注特定方面
wrangler-devtool review ./my-agent --deep --prompt "检查安全问题"
```

### 会话管理

```bash
# 列出会话
wrangler-devtool session list
wrangler-devtool session list /path/to/project

# 从第 N 条消息分叉会话
wrangler-devtool session fork <session-id> --msg=5
```

## 安装

```bash
pnpm add -D @agentskillmania/wrangler-devtool
```

或直接通过 npx 使用：

```bash
npx wrangler-devtool --help
```

## 配置

Devtool 复用 wrangler CLI 的配置（`wrangler.yaml` 或 `~/.agentskillmania/wrangler/config.yaml`）：

```yaml
llm:
  provider: openai
  apiKey: sk-your-key
  model: gpt-4o
```

## CLI 参考

```
wrangler-devtool <command>

命令：
  init --mode <agent|crew|bare> [dir]    初始化工作空间
  agent create <name>                    创建空 agent 模板
  agent write [name] --prompt <text>     用 AI 生成/修改 agent
  skill create <name>                    创建空 skill 模板
  skill write [name] --prompt <text>     用 AI 生成/修改 skill
  crew create <name>                     创建空 crew 模板
  crew write [name] --prompt <text>      用 AI 生成/修改 crew
  test <path> [options]                  运行声明式测试
  review <path> [options]                质量评审（只读）
  session list [workspace]               列出会话
  session fork <id> --msg=N              分叉会话

全局选项：
  --help     显示帮助
  --version  显示版本
```

## 设计原则

- **默认非交互式** — 所有命令完全可脚本化。无提示，无菜单。
- **安全变更** — 文件修改使用 `old → new` 匹配验证。不盲目覆盖。
- **内置智能体私有化** — 提示词打包在代码中。用户通过 CLI 调用，不可编辑。

## 许可证

MIT
