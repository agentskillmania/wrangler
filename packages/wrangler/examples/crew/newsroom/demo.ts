/**
 * Demo: Newsroom (Crew multi-agent)
 *
 * Editor-in-chief receives a pitch, reporters use web_search (backed by Zhipu MCP)
 * to research real data, editor synthesizes into a feature article.
 *
 * Required env vars:
 *   OPENAI_API_KEY  — LLM access
 *   ZHIPU_API_KEY   — Zhipu MCP web search (optional; falls back to no search)
 *
 * Run: cd packages/wrangler && pnpm demo:newsroom
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Crew, CrewLoader } from '@agentskillmania/wrangler';
import type { CrewOutputEvent } from '@agentskillmania/wrangler';
import { getDemoConfig } from '../../demo-config.js';
import { createMCPSearchProvider } from '../../mcp-search-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function formatNewsroomEvent(event: CrewOutputEvent): string {
  switch (event.type) {
    case 'agent_created': {
      const roles: Record<string, string> = {
        primary: '主编',
        liaison: '编辑部',
        worker: '记者',
      };
      return `  >> ${roles[event.role] ?? event.role} 加入: ${event.definitionName} (${event.agentId})`;
    }
    case 'task_started':
      return `  >> 采访任务下达: [${event.taskId}] ${event.workerType} — "${event.description}"`;
    case 'tool_invoked': {
      const argsStr = JSON.stringify(event.args);
      const short = argsStr.length > 60 ? argsStr.slice(0, 60) + '...' : argsStr;
      return `  >> ${event.agentId} 调用工具: ${event.toolName}(${short})`;
    }
    case 'tool_completed': {
      const short = event.result.length > 80 ? event.result.slice(0, 80) + '...' : event.result;
      return `  >> ${event.agentId} ← ${event.toolName} (${event.duration}ms): ${short}`;
    }
    case 'message_routed':
      return `  >> 稿件流转: ${event.from} → ${event.to}`;
    case 'agent_advanced':
      return `  >> ${event.agentId} 交稿了 (${event.resultType}，耗时 ${event.duration}ms)`;
    case 'task_completed':
      return `  >> 报道完成: [${event.taskId}]`;
    case 'task_failed':
      return `  >> 截稿未完成: [${event.taskId}] — ${event.error}`;
    case 'todolist_updated': {
      const items = event.todolist.map(
        (t) => `${t.status === 'done' ? '✓' : t.status === 'in_progress' ? '►' : '○'} ${t.content}`
      );
      return `  >> 编辑部待办: ${items.join(' | ')}`;
    }
    case 'user_response':
      return '';
    case 'error':
      return `  >> 编辑部警报: ${event.error.message}`;
    default:
      return `  >> ${(event as { type: string }).type}`;
  }
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
  console.log(
    `风格指南:      ${config.skillDirs.length > 0 ? '特稿写作技能已加载' : '(无)'}`
  );
  console.log(`搜索:         ${searchProvider ? '智谱 MCP (真实)' : '(无)'}`);
  console.log(`模型:         ${model}\n`);

  const crew = new Crew(config, {
    llmClient: llmProvider,
    defaultModel: model,
    workspaceDeps: { workspacePath: process.cwd() },
    searchProvider,
    mcpConfigPaths: [],
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
      const line = formatNewsroomEvent(event);
      if (line) console.log(line);
    });
  }

  const pitch =
    '亚洲植物肉市场的崛起：文化接受度、市场动态，以及谁在赢得亚洲人的味蕾。请记者们用 web_search 搜索真实的新闻报道、市场数据和社交媒体讨论。';

  console.log('═══ 选题提报 ═══');
  console.log(`  "${pitch}"`);
  console.log('═════════════════\n');

  console.log('编辑部开会中...\n');

  crew.pushInput({ type: 'user_message', content: pitch });

  const article = await new Promise<string>((resolve) => {
    // Take the last non-empty user_response
    let latest = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    crew.on('user_response', (event) => {
      const content = event.content?.trim() ?? '';
      if (content) latest = content;
      // Debounce: resolve 3s after the last response
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => resolve(latest), 3000);
    });
  });

  console.log('\n═══ 发表特稿 ═══');
  if (article) {
    console.log(article);
  } else {
    console.log('(主编未返回文字回复，特稿可能已写入文件)');
  }

  // Stop the crew and clean up
  crew.pushInput({ type: 'stop' });
  await mcpCleanup();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
