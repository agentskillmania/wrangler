/**
 * Demo: Travel Concierge (Agent)
 *
 * Atlas plans a Tokyo trip using web_search (backed by Zhipu MCP) and web_fetch for real info.
 * Demonstrates: MCP-powered web_search → web_fetch → analysis.
 *
 * Required env vars:
 *   OPENAI_API_KEY  — LLM access
 *   ZHIPU_API_KEY   — Zhipu MCP web search (optional; falls back to no search)
 *
 * Run: cd packages/wrangler && pnpm demo:travel-concierge
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { getDemoConfig } from '../../demo-config.js';
import { createMCPSearchProvider } from '../../mcp-search-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Atlas 旅行管家 — 智能体演示');
  console.log('═══════════════════════════════════════════\n');

  // ── Step 1: Load agent definition ──
  console.log('【步骤 1】加载智能体定义...');
  const loaded = await AgentLoader.loadFrom(join(__dirname, 'agent'));
  console.log(`  ✓ 已加载: ${loaded.meta.name}`);
  console.log(`  ✓ 描述: ${loaded.meta.description}\n`);

  // ── Step 2: Initialize ──
  console.log('【步骤 2】初始化...');
  const { provider: llmProvider, model } = getDemoConfig();
  console.log(`  ✓ 模型: ${model}\n`);

  // ── Step 3: Setup MCP search provider ──
  console.log('【步骤 3】配置 MCP 搜索...');
  let searchProvider = undefined;
  let mcpCleanup = async () => {};
  const apiKey = process.env.OPENAI_API_KEY; // same key for Zhipu LLM + MCP
  if (apiKey) {
    try {
      const { provider, cleanup } = await createMCPSearchProvider({ apiKey });
      searchProvider = provider;
      mcpCleanup = cleanup;
      console.log('  ✓ 智谱 MCP 搜索已就绪\n');
    } catch (e) {
      console.warn(`  ⚠ MCP 搜索加载失败: ${(e as Error).message}\n`);
    }
  } else {
    console.log('  ⚠ 未设置 OPENAI_API_KEY，搜索不可用\n');
  }

  // ── Step 4: Create EnhancedRunner ──
  console.log('【步骤 4】创建 EnhancedRunner...');
  const runner = await EnhancedRunner.create({
    llmClient: llmProvider,
    model,
    workspacePath: process.cwd(),
    searchProvider,
    skillDirectories: loaded.skillDirs,
    thinkingEnabled: loaded.meta.thinking?.enabled,
  });

  console.log('  ✓ Runner 就绪\n');

  // ── Step 5: Submit travel request ──
  const request = `
请为 3 人家庭规划 5 天东京行程，具体要求如下：

- 预算：2 万元人民币（不含机票）
- 旅行者：2 位成人 + 1 位老人（72 岁，拄拐杖）
- 兴趣：建筑（尤其喜欢安藤忠雄、隈研吾），居酒屋，传统手工艺
- 饮食：其中一位是鱼素者
- 无障碍：需要无障碍路线，尽量少台阶，附近有休息区
- 节奏：轻松——每天最多 3 个主要活动
- 季节：11 月下旬（红叶季）
- 必须包含：至少一次对行动不便者友好的温泉体验

请先搜索东京安藤忠雄和隈研吾的建筑作品、无障碍温泉、鱼素者友好的居酒屋，再规划行程。
  `.trim();

  console.log('═══════════════════════════════════════════');
  console.log('【步骤 5】提交旅行需求');
  console.log('═══════════════════════════════════════════\n');

  let state = createAgentState({
    name: loaded.name,
    instructions: loaded.instructions,
    tools: [],
  });
  state = addUserMessage(state, request);

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
  console.log('✓ 行程规划完成');

  await mcpCleanup();
}

main().catch(console.error);
