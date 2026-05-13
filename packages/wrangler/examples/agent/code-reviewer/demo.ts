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
  console.log(`  ✓ 已加载: ${loaded.meta.name}`);
  console.log(`  ✓ 描述: ${loaded.meta.description}\n`);

  // ── Step 2: Initialize LLM client ──
  console.log('【步骤 2】初始化 LLM 客户端...');
  const { provider: llmProvider, model } = getDemoConfig();
  console.log(`  ✓ 模型: ${model}\n`);

  // ── Step 3: Create EnhancedRunner ──
  console.log('【步骤 3】创建 EnhancedRunner...');
  const workspacePath = join(__dirname, 'workspace');
  console.log(`  ✓ 工作目录: ${workspacePath}`);

  const runner = await EnhancedRunner.create({
    llmClient: llmProvider,
    model,
    workspacePath,
    skillDirectories: loaded.skillDirs,
    thinkingEnabled: loaded.meta.thinking?.enabled,
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

  for await (const event of runner.runStream(state, { maxSteps: 100 })) {
    switch (event.type) {
      case 'step:start':
        stepNum++;
        console.log(`\n  ── ReAct 步骤 #${stepNum} ──`);
        break;
      case 'token':
        process.stdout.write(event.token);
        break;
      case 'thinking':
        process.stdout.write(`\x1b[90m${event.content}\x1b[0m`);
        break;
      case 'tool:start': {
        const args = JSON.stringify(event.action.arguments);
        const short = args.length > 100 ? args.slice(0, 100) + '...' : args;
        console.log(`\n  🔧 调用工具: ${event.action.tool}(${short})`);
        break;
      }
      case 'tool:end': {
        const result = String(event.result);
        const short = result.length > 200 ? result.slice(0, 200) + '...' : result;
        console.log(`  📋 工具返回: ${short}\n`);
        break;
      }
      case 'llm:request':
        console.log('  🤖 正在调用 LLM...');
        break;
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`\n═══ 运行结束 ═══`);
  console.log(`总步骤数: ${stepNum}`);
  console.log('✓ 审查完成');
}

main().catch(console.error);
