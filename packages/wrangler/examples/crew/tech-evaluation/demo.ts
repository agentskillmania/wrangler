/**
 * Demo: Tech Evaluation Committee (Crew multi-agent)
 *
 * Tech lead splits "Bun migration assessment" into parallel research tasks,
 * workers use web_search/web_fetch for real data, lead synthesizes findings.
 *
 * Run: cd packages/wrangler && pnpm demo:tech-evaluation
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Crew, CrewLoader } from '@agentskillmania/wrangler';
import type { CrewOutputEvent } from '@agentskillmania/wrangler';
import { getDemoConfig } from '../../../demo-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function formatEvent(event: CrewOutputEvent): string {
  switch (event.type) {
    case 'agent_created':
      return `[${ts()}] 智能体上线: ${event.definitionName} (${event.role}) → ${event.agentId}`;
    case 'task_started':
      return `[${ts()}] 调研任务启动: [${event.taskId}] ${event.workerType} — "${event.description}"`;
    case 'tool_invoked': {
      const argsStr = JSON.stringify(event.args);
      const short = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;
      return `[${ts()}] 工具调用: ${event.agentId} → ${event.toolName}(${short})`;
    }
    case 'tool_completed': {
      const short = event.result.length > 60 ? event.result.slice(0, 60) + '...' : event.result;
      return `[${ts()}] 工具完成: ${event.agentId} ← ${event.toolName} (${event.duration}ms): ${short}`;
    }
    case 'message_routed':
      return `[${ts()}] 消息路由: ${event.from} → ${event.to} ("${event.contentPreview.slice(0, 50)}...")`;
    case 'agent_advanced':
      return `[${ts()}] 智能体推进: ${event.agentId} (${event.role}) — ${event.resultType}，耗时 ${event.duration}ms`;
    case 'task_completed': {
      const short = event.result.length > 80 ? event.result.slice(0, 80) + '...' : event.result;
      return `[${ts()}] 任务完成: [${event.taskId}] 结果: ${short}`;
    }
    case 'task_failed':
      return `[${ts()}] 任务失败: [${event.taskId}] 错误: ${event.error}`;
    case 'todolist_updated': {
      const items = event.todolist.map(
        (t) => `${t.status === 'done' ? '✓' : t.status === 'in_progress' ? '►' : '○'} ${t.title}`
      );
      return `[${ts()}] 待办列表: ${items.join(' | ')}`;
    }
    case 'user_response':
      return `\n[${ts()}] ━━━ 最终建议 ━━━\n`;
    case 'error':
      return `[${ts()}] 错误: ${event.error.message}`;
    default:
      return `[${ts()}] ${(event as { type: string }).type}`;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  技术选型评估委员会 — Crew 多智能体演示');
  console.log('═══════════════════════════════════════════════════════\n');

  const crewDir = join(__dirname, 'crew');
  const loader = new CrewLoader(crewDir);
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

  const crew = new Crew(config, {
    llmClient: llmProvider,
    defaultModel: model,
    workspaceDeps: { workspacePath: process.cwd() },
  });

  const eventTypes: CrewOutputEvent['type'][] = [
    'agent_created',
    'agent_advanced',
    'task_started',
    'task_completed',
    'task_failed',
    'tool_invoked',
    'tool_completed',
    'message_routed',
    'todolist_updated',
    'error',
    'user_response',
  ];

  for (const eventType of eventTypes) {
    crew.on(eventType, (event: CrewOutputEvent) => {
      console.log(formatEvent(event));
    });
  }

  const question =
    '我们的 Node.js 后端是否应该迁移到 Bun 运行时？请让调研员用 web_search 搜索真实数据来做评估。';

  console.log('评估问题：');
  console.log(`  "${question}"\n`);
  console.log('委员会开会中...');
  console.log('─'.repeat(55));

  crew.pushInput({ type: 'user_message', content: question });

  const response = await new Promise<string>((resolve) => {
    crew.on('user_response', (event) => resolve(event.content));
  });

  console.log(response);
}

main().catch(console.error);
