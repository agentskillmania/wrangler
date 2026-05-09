/**
 * Layer 8 集成测试：Primary 接收用户消息，调用 create_task 创建 Worker，
 * Worker 执行任务后通过 Liaison relay 结果回 Primary，Primary 回复用户。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { Crew } from '../../src/crew/crew.js';
import type { CrewConfig, CrewOutputEvent } from '../../src/crew/types.js';
import { testConfig, itif } from './config.js';

const config = testConfig;

function createLLMClient(): LLMClient {
  const client = new LLMClient({ baseUrl: config.baseUrl });
  client.registerProvider({ name: config.provider, maxConcurrency: 5 });
  client.registerApiKey({
    key: config.apiKey,
    provider: config.provider,
    maxConcurrency: 5,
    models: [{ modelId: config.testModel, maxConcurrency: 5 }],
  });
  return client;
}

const crewConfig: CrewConfig = {
  meta: {
    name: 'test-peer-crew',
    description: 'A test crew for peer collaboration',
    primaryAgent: 'primary',
  },
  memory: '',
  agentDefs: {
    primary: {
      meta: { name: 'primary' },
      instructions: `你是协调者。当用户提出问题时：
1. 使用 create_task 创建一个 searcher 类型的 worker 来搜索答案
2. 等待 worker 通过 liaison 传回结果
3. 收到结果后，直接把答案告诉用户（用中文回复）`,
    },
    searcher: {
      meta: { name: 'searcher' },
      instructions: `你是搜索员。收到搜索任务后：
1. 用 send_to_liaison 工具发送搜索结果
结果要简洁。`,
    },
  },
  skillDirs: [],
};

describe('Crew peer collaboration', () => {
  beforeAll(() => {
    if (!config.enabled) {
      console.log('[Crew Integration] Skipped: ENABLE_INTEGRATION_TESTS not set');
    }
  });

  itif(config.enabled)(
    'primary creates task and gets result back via liaison',
    async () => {
      const llmClient = createLLMClient();
      const crew = new Crew(crewConfig, {
        llmClient,
        defaultModel: config.testModel,
      });

      const events: CrewOutputEvent[] = [];
      crew.on('user_response', (e) => events.push(e));
      crew.on('agent_created', (e) => events.push(e));
      crew.on('task_started', (e) => events.push(e));
      crew.on('error', (e) => events.push(e));

      crew.pushInput({ type: 'user_message', content: '请搜索 TypeScript 的最新版本号' });

      // Wait for the crew to finish processing
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 120_000));
      const userResponse = new Promise<CrewOutputEvent>((resolve) => {
        const unsub = crew.on('user_response', (e) => {
          unsub();
          resolve(e);
        });
      });

      const result = await Promise.race([
        userResponse,
        timeout.then(() => null as unknown as CrewOutputEvent),
      ]);

      expect(result).not.toBeNull();
      expect(result.type).toBe('user_response');
      expect((result as { content: string }).content.length).toBeGreaterThan(0);

      // Should have created agents
      const createdEvents = events.filter((e) => e.type === 'agent_created');
      expect(createdEvents.length).toBeGreaterThanOrEqual(1); // at least primary

      console.log(
        '[Crew Integration] Events:',
        events.map((e) => e.type)
      );
      console.log('[Crew Integration] User response:', (result as { content: string }).content);
    },
    180_000
  );
});
