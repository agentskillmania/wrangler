# @agentskillmania/wrangler-devtool

[![npm version](https://img.shields.io/npm/v/@agentskillmania/wrangler-devtool.svg)](https://www.npmjs.com/package/@agentskillmania/wrangler-devtool)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Wrangler Devtool** 是 Wrangler 生态的开发工具包，只做三件事：

1. **脚手架** — 初始化 agent/skill 项目目录
2. **提供内置 skill** — 上层智能体可通过 `load_skill` 加载
3. **评估** — 通过 YAML 定义的测试框架评估 agent 和 skill

devtool 本身不含任何 AI 逻辑——生成、评审、编排等能力都封装在内置 skill 中，由上层应用（如 skill-studio）加载使用。

## 安装

```bash
pnpm add -D @agentskillmania/wrangler-devtool
```

或直接通过 npx 使用：

```bash
npx wrangler-devtool --help
```

## 命令

### `init` — 初始化项目

创建标准结构的 agent 或 skill 项目目录（AGENT.md、skills/、evals/、mcp.json、.gitignore、git 仓库）。

```bash
wrangler-devtool init --type agent ./my-agent
wrangler-devtool init --type crew ./my-crew
wrangler-devtool init --type skill ./my-skill
wrangler-devtool init --type agent --no-git ./my-agent
```

生成的目录结构：

```
my-agent/
├── AGENT.md          # Agent 定义（frontmatter + 指令）
├── skills/           # 此 agent 可加载的 skill
│   └── example.md
├── evals/            # 评估套件
│   └── example.yaml
├── mcp.json          # MCP 服务器配置
├── .gitignore        # 忽略 .eval/ 和 node_modules/
└── .git/
```

### `create` — 创建模板文件

生成空的 agent、skill 或 crew 模板文件。

```bash
wrangler-devtool create agent my-bot
wrangler-devtool create skill search-web
wrangler-devtool create crew dev-team
```

### `eval` — 运行评估套件

运行 YAML 定义的评估套件，评估 agent 或 skill。支持多次采样、确定性评估器和 LLM-as-Judge。

```bash
# 默认运行
wrangler-devtool eval evals/baseline.yaml

# 覆盖采样次数
wrangler-devtool eval evals/baseline.yaml --runs 5

# 自定义输出目录
wrangler-devtool eval evals/baseline.yaml --output ./reports

# JSON 输出（用于 CI）
wrangler-devtool eval evals/baseline.yaml --reporter json
```

**选项：**

| 参数 | 说明 |
|---|---|
| `--runs N` | 覆盖 `sampling.runs` |
| `--output DIR` | 输出目录（默认：`.eval/runs/<runId>`） |
| `--reporter console\|json` | 输出格式（默认：`console`） |
| `--keep-traces` | 运行后保留临时工作区 |

## 评估框架

### 套件 YAML 格式

```yaml
name: code-reviewer-eval
description: 评估 code-reviewer agent

target:
  type: agent              # agent | skill
  path: ./                 # agent 定义目录（skill 类型时为 skill 父目录）
  skill: null              # type=skill 时指定要加载的 skill 名

sampling:
  runs: 3                  # 每个用例跑 3 次
  passThreshold: 0.67      # 需 2/3 通过才算 pass
  # temperature: 0         # 取消注释以使用确定性单次模式
  # maxSteps: 20           # 每次运行的最大步数

cases:
  - name: detect-sql-injection
    description: 应检测到 SQL 注入
    input:
      message: 审查这段代码的安全问题
    context:
      files:               # fixture 文件，拷贝到临时工作区
        - source: fixtures/vulnerable.py
          target: src/main.py
      env:
        MODE: strict
    evaluators:
      - type: output_contains
        value: "SQL injection"
        caseInsensitive: true
      - type: tool_called
        tool: file_read
      - type: file_exists
        path: review.md
      - type: llm-judge
        name: thoroughness
        criteria: 安全、性能、可维护性的覆盖程度
        rubric:
          - { score: 5, description: 全面深入 }
          - { score: 1, description: 遗漏关键问题 }
        minScore: 3
```

### 内置评估器

**确定性评估器：**

| 类型 | 说明 |
|---|---|
| `output_contains` / `output_not_contains` | 检查输出文本（支持 `caseInsensitive`） |
| `output_equals` | 严格相等 |
| `output_matches` | 正则匹配（支持 `flags`） |
| `tool_called` / `tool_not_called` | 是否调用了指定工具 |
| `tool_called_with` | 工具调用参数匹配（子集匹配） |
| `tool_call_count` | 工具调用次数在 `min`/`max` 范围内 |
| `file_exists` / `file_not_exists` | 工作区中文件是否存在（支持 `contentContains`） |
| `exit_code` | 运行结果类型（`success`、`error`、`max_steps` 等） |
| `step_count` | 步数在 `min`/`max` 范围内 |

**LLM-as-Judge：**

| 类型 | 说明 |
|---|---|
| `llm-judge` | LLM 根据完整轨迹（输出 + 工具调用）按 `criteria` 和 `rubric` 评分。支持 `reference` 黄金答案。固定使用 `temperature: 0` 保证确定性。 |

### 输出结构

```
.eval/runs/2026-07-14T09-00-00-my-suite/
├── report.json                          # 结构化报告
└── traces/
    ├── detect-sql-injection.sample-0.jsonl   # 每个用例 × 每次采样
    ├── detect-sql-injection.sample-1.jsonl
    └── detect-sql-injection.sample-2.jsonl
```

trace 文件为 JSONL 格式——每行一个 JSON 事件（`meta`、`input`、`tool_call`、`tool_result`、`final`、`stats`）。

## 内置 Skill

devtool 内置五个 skill，上层智能体可通过 `load_skill` 加载：

| Skill | 用途 |
|---|---|
| `agent-architect` | 设计和编写 agent 定义 |
| `skill-designer` | 设计和编写 skill 定义 |
| `crew-composer` | 编排多智能体 crew 定义 |
| `definition-reviewer` | 评审 agent/skill/crew 定义质量 |
| `session-curator` | 管理和整理对话会话 |

上层应用导入 `BUILTIN_SKILLS_DIR` 并添加到 `skills.dirs`：

```typescript
import { BUILTIN_SKILLS_DIR } from '@agentskillmania/wrangler-devtool';

const runner = await EnhancedRunner.create({
  skills: { dirs: [BUILTIN_SKILLS_DIR] },
  // ...
});
```

## 配置

评估使用与 wrangler 相同的 LLM 配置。搜索顺序（第一个含 `llm.providers` 的生效）：

1. `projectDir/eval-config.yaml` — 评估专用覆盖（支持 `judge.model`）
2. `projectDir/wrangler.yaml` — 项目配置
3. `{appDir}/config.yaml` — 全局配置（`AGENTSKILLMANIA_APP_DIR` ?? `~/.agentskillmania/skill-studio`）
4. `OPENAI_API_KEY` 环境变量 — CI 兜底

`eval-config.yaml` 示例（指定 judge 用不同模型）：

```yaml
llm:
  providers:
    - name: openai
      apiKey: sk-your-key
      baseUrl: https://api.example.com/v1
      models:
        - modelId: glm-5.1    # 被评估的 agent 使用
        - modelId: glm-5.2    # 供 judge 使用

judge:
  model: glm-5.2              # 用更强的模型做评判
```

## 编程接口

```typescript
import { runEval, loadSuite } from '@agentskillmania/wrangler-devtool';

const suite = await loadSuite('./evals/baseline.yaml');
const { report, outputDir } = await runEval(suite, {
  runs: 3,
  outputDir: './reports',
});
```

## 设计原则

- **devtool 不做 AI** — 只做脚手架和文件操作；AI 能力封装在内置 skill 中，由上层智能体加载
- **默认非交互式** — 所有命令完全可脚本化，无提示，无菜单
- **安全变更** — 文件修改使用 `old → new` 匹配验证，不盲目覆盖

## 许可证

MIT
