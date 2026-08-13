/**
 * Demo: Tech Evaluation Committee (Crew 多智能体)
 *
 * Tech lead splits "Bun migration assessment" into parallel research tasks,
 * workers use web_search/web_fetch for real data, lead synthesizes findings.
 *
 * 现行 API：CrewLoader 加载 CREW.md + agents/*.md → crewToRunnerOptions 生成
 * EnhancedRunner 选项（主智能体 + delegate 子智能体 + 技能目录），
 * 事件经 runner.on() 订阅（子智能体事件由 delegate 工具转发）。
 *
 * Run: cd packages/wrangler && pnpm demo:tech-evaluation
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CrewLoader, crewToRunnerOptions, EnhancedRunner } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { getDemoConfig } from '../../demo-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  技术选型评估委员会 — Crew 多智能体演示');
  console.log('═══════════════════════════════════════════════════════\n');

  const crewDir = join(__dirname, 'crew');
  const loader = new CrewLoader(crewDir, defaultNodeHostEnv);
  const config = await loader.load();
  const { provider: llmProvider, model } = getDemoConfig();

  console.log(`Crew:         ${config.meta.name}`);
  console.log(`描述:         ${config.meta.description}`);
  console.log(`主智能体:      ${config.meta.primaryAgent}`);
  console.log(
    `Worker:       ${Object.keys(config.agentDefs)
      .filter((n) => n !== config.meta.primaryAgent)
      .join(', ')}`
  );
  console.log(`技能目录:      ${config.skillDirs.length > 0 ? '已配置' : '(无)'}`);
  console.log(`模型:         ${model}\n`);

  const runner = await EnhancedRunner.create({
    ...crewToRunnerOptions(config),
    llm: { client: llmProvider, model },
    runtime: defaultNodeHostEnv,
    workspacePath: process.cwd(),
    tools: { mcpConfigPaths: [] },
  });

  // 事件日志（AgentRunner EventEmitter；delegate 工具会把子智能体事件转发上来）
  runner.on('tool:start', (data) => {
    const { action } = data as { action: { tool: string; arguments: Record<string, unknown> } };
    const argsStr = JSON.stringify(action.arguments);
    const short = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;
    console.log(`[${ts()}] 工具调用: ${action.tool}(${short})`);
  });
  runner.on('tool:end', (data) => {
    const evt = data as { result: unknown; duration?: number };
    const resultStr = JSON.stringify(evt.result);
    const short = resultStr.length > 80 ? resultStr.slice(0, 80) + '...' : resultStr;
    console.log(`[${ts()}] 工具完成: ${short}`);
  });
  runner.on('step:start', (data) => {
    const { step } = data as { step: number };
    console.log(`[${ts()}] 步骤 ${step} 开始`);
  });

  const question =
    '我们的 Node.js 后端是否应该迁移到 Bun 运行时？请让调研员用 web_search 搜索真实数据来做评估。';

  console.log('评估问题：');
  console.log(`  "${question}"\n`);
  console.log('委员会开会中...');
  console.log('─'.repeat(55));

  let state = createAgentState({ name: config.meta.primaryAgent, instructions: '', tools: [] });
  state = addUserMessage(state, question);

  const { result } = await runner.run(state);

  console.log('\n━━━ 最终评估建议 ━━━');
  if (result.type === 'success') {
    console.log(result.answer);
  } else if (result.type === 'stopped') {
    console.log(result.data ?? '(主智能体未返回文字回复)');
  } else if (result.type === 'error') {
    console.log(`运行失败: ${result.error.message}`);
  } else {
    console.log(`运行结束: ${result.type}`);
  }
  console.log(`\n步骤数: ${result.totalSteps}`);
}

main().catch(console.error);
