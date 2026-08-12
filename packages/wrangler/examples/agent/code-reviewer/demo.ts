/**
 * Demo: Code Reviewer (Agent)
 *
 * Phoenix reviews real code files from disk using tools.
 * Demonstrates: glob → file_read → grep → analysis.
 *
 * Run: cd packages/wrangler && pnpm demo:code-reviewer
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { getDemoConfig } from '../../demo-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Phoenix 代码审查员 — 智能体演示');
  console.log('═══════════════════════════════════════════\n');

  // ── Step 1: Load agent definition from AGENT.md ──
  console.log('【步骤 1】加载智能体定义...');
  const loaded = await AgentLoader.loadFrom(join(__dirname, 'agent'));
  console.log(`  ✓ 已加载: ${loaded.name}`);
  console.log(`  ✓ 描述: ${loaded.description}\n`);

  // ── Step 2: Initialize LLM client ──
  console.log('【步骤 2】初始化 LLM 客户端...');
  const { provider: llmProvider, model } = getDemoConfig();
  console.log(`  ✓ 模型: ${model}\n`);

  // ── Step 3: Create EnhancedRunner ──
  console.log('【步骤 3】创建 EnhancedRunner...');
  const workspacePath = join(__dirname, 'workspace');
  console.log(`  ✓ 工作目录: ${workspacePath}`);

  const runner = await EnhancedRunner.create({
    llm: { client: llmProvider, model },
    workspacePath,
    skills: { dirs: loaded.skillDirs },
    thinking: { enabled: loaded.thinking?.enabled },
  });

  console.log('  ✓ Runner 就绪\n');

  // ── Step 4: Run ──
  console.log('═══════════════════════════════════════════');
  console.log('【步骤 4】提交代码审查任务');
  console.log('═══════════════════════════════════════════\n');

  let state = createAgentState({
    name: loaded.name,
    instructions: loaded.instructions,
    tools: [],
  });

  // Tell agent to review files in workspace — it will use tools to read them
  state = addUserMessage(
    state,
    '请审查 workspace 目录下所有 .ts 源代码文件。用 glob("**/*.ts") 列出文件，再用 file_read 逐个读取，最后给出审查报告。不要搜索其他文件类型。'
  );

  console.log('─'.repeat(50));

  let stepNum = 0;

  // 事件订阅（AgentRunner EventEmitter）——run() 阻塞执行期间实时输出
  runner.on('step:start', () => {
    stepNum++;
    console.log(`\n  ── ReAct 步骤 #${stepNum} ──`);
  });
  runner.on('token', (data) => {
    process.stdout.write((data as { token: string }).token);
  });
  runner.on('thinking', (data) => {
    process.stdout.write(`\x1b[90m${(data as { content: string }).content}\x1b[0m`);
  });
  runner.on('tool:start', (data) => {
    const { action } = data as { action: { tool: string; arguments: Record<string, unknown> } };
    const args = JSON.stringify(action.arguments);
    const short = args.length > 100 ? args.slice(0, 100) + '...' : args;
    console.log(`\n  🔧 调用工具: ${action.tool}(${short})`);
  });
  runner.on('tool:end', (data) => {
    const { result } = data as { result: unknown };
    const resultStr = String(result);
    const short = resultStr.length > 200 ? resultStr.slice(0, 200) + '...' : resultStr;
    console.log(`  📋 工具返回: ${short}\n`);
  });
  runner.on('llm:request', () => {
    console.log('  🤖 正在调用 LLM...');
  });

  const { result } = await runner.run(state, { maxSteps: 100 });

  console.log('\n' + '─'.repeat(50));
  console.log(`\n═══ 运行结束 ═══`);
  console.log(`总步骤数: ${stepNum}`);
  console.log('✓ 审查完成');
}

main().catch(console.error);
