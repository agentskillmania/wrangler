/**
 * Demo: 编辑部新闻室（Crew 多智能体）
 *
 * 主编派记者们用 web_search 搜索真实数据，分头调研后合成特稿。
 *
 * 现行 API：CrewLoader 加载 CREW.md + agents/*.md → crewToRunnerOptions 生成
 * EnhancedRunner 选项（主智能体 + delegate 子智能体 + 技能目录），
 * 事件经 runner.on() 订阅（子智能体事件由 delegate 工具转发）。
 *
 * Run: cd packages/wrangler && pnpm demo:newsroom
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrewLoader, crewToRunnerOptions, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { getDemoConfig } from '../../demo-config.js';
import { createMCPSearchProvider } from '../../mcp-search-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  编辑部新闻室 — Crew 多智能体演示');
  console.log('═══════════════════════════════════════════════════════\n');

  const crewDir = join(__dirname, 'crew');
  const loader = new CrewLoader(crewDir);
  const config = await loader.load();
  const { provider: llmProvider, model } = getDemoConfig();

  // Setup MCP search
  let searchProvider = undefined;
  let mcpCleanup = async () => {};
  const apiKey = process.env.OPENAI_API_KEY; // same key for Zhipu LLM + MCP
  if (apiKey) {
    try {
      const { provider, cleanup } = await createMCPSearchProvider({ apiKey });
      searchProvider = provider;
      mcpCleanup = cleanup;
    } catch (e) {
      console.warn(`  ⚠ MCP 搜索加载失败: ${(e as Error).message}`);
    }
  }

  console.log(`刊物:         ${config.meta.name}`);
  console.log(`主编:         ${config.meta.primaryAgent}`);
  console.log(
    `记者:         ${Object.keys(config.agentDefs)
      .filter((n) => n !== config.meta.primaryAgent)
      .join(', ')}`
  );
  console.log(`风格指南:      ${config.skillDirs.length > 0 ? '特稿写作技能已加载' : '(无)'}`);
  console.log(`搜索:         ${searchProvider ? '智谱 MCP (真实)' : '(无)'}`);
  console.log(`模型:         ${model}\n`);

  const runner = await EnhancedRunner.create({
    ...crewToRunnerOptions(config),
    llm: { client: llmProvider, model },
    workspacePath: process.cwd(),
    ...(searchProvider ? { search: { provider: searchProvider } } : {}),
    tools: { mcpConfigPaths: [] },
  });

  // 编辑部事件流（AgentRunner EventEmitter；delegate 工具转发子智能体事件）
  runner.on('tool:start', (data) => {
    const { action } = data as { action: { tool: string; arguments: Record<string, unknown> } };
    const argsStr = JSON.stringify(action.arguments);
    const short = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;
    console.log(`[${ts()}] 记者调用工具: ${action.tool}(${short})`);
  });
  runner.on('tool:end', (data) => {
    const evt = data as { result: unknown };
    const resultStr = JSON.stringify(evt.result);
    const short = resultStr.length > 80 ? resultStr.slice(0, 80) + '...' : resultStr;
    console.log(`[${ts()}] 工具完成: ${short}`);
  });
  runner.on('step:start', (data) => {
    const { step } = data as { step: number };
    console.log(`[${ts()}] 步骤 ${step} 开始`);
  });

  const pitch =
    '亚洲植物肉市场的崛起：文化接受度、市场动态，以及谁在赢得亚洲人的味蕾。请记者们用 web_search 搜索真实的新闻报道、市场数据和社交媒体讨论。';

  console.log('═══ 选题提报 ═══');
  console.log(`  "${pitch}"`);
  console.log('═════════════════\n');

  console.log('编辑部开会中...\n');

  let state = createAgentState({ name: config.meta.primaryAgent, instructions: '', tools: [] });
  state = addUserMessage(state, pitch);

  const { result } = await runner.run(state);

  console.log('\n═══ 发表特稿 ═══');
  if (result.type === 'success') {
    console.log(result.answer);
  } else if (result.type === 'stopped') {
    console.log(result.data ?? '(主编未返回文字回复，特稿可能已写入文件)');
  } else if (result.type === 'error') {
    console.log(`截稿失败: ${result.error.message}`);
  } else {
    console.log(`运行结束: ${result.type}`);
  }
  console.log(`\n步骤数: ${result.totalSteps}`);

  await mcpCleanup();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
