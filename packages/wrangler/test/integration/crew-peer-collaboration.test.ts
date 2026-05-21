/**
 * Layer 8 integration test: Primary receives user message, calls create_task
 * to create Worker, Worker output auto-routes to Liaison, Liaison relays
 * result back to Primary, Primary responds to user.
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
      name: 'primary',
      instructions: `你是协调者。当用户提出问题时：
1. 使用 create_task 创建一个 searcher 类型的 worker 来搜索答案
2. 等待 liaison 通过 relay_to_primary 传回结果
3. 收到结果后，直接把答案告诉用户（用中文回复）`,
    },
    searcher: {
      name: 'searcher',
      instructions: `你是搜索员。收到搜索任务后，直接回答搜索结果。
你的回答会自动传给liaison。结果要简洁。`,
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
    'primary creates task and gets result back via auto-routing',
    async () => {
      const llmClient = createLLMClient();
      const crew = new Crew(crewConfig, {
        llmClient,
        defaultModel: config.testModel,
      });

      const events: CrewOutputEvent[] = [];
      const eventTypes = [
        'user_response',
        'agent_created',
        'task_started',
        'task_completed',
        'error',
        'tool_invoked',
        'tool_completed',
        'agent_advanced',
        'message_routed',
      ];
      for (const type of eventTypes) {
        crew.on(type, (e) => events.push(e));
      }

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

      expect(result).toHaveProperty('content');
      expect(result.type).toBe('user_response');
      expect((result as { content: string }).content.length).toBeGreaterThan(0);

      // Should have created agents (primary + liaison + worker)
      const createdEvents = events.filter((e) => e.type === 'agent_created');
      expect(createdEvents.length).toBeGreaterThanOrEqual(3);

      // Should have auto-routed messages
      const routedEvents = events.filter((e) => e.type === 'message_routed');
      expect(routedEvents.length).toBeGreaterThanOrEqual(1);

      // Should have agent_advanced events with duration
      const advancedEvents = events.filter((e) => e.type === 'agent_advanced');
      for (const e of advancedEvents) {
        const adv = e as { duration: number };
        expect(adv.duration).toBeGreaterThanOrEqual(0);
      }

      console.log(
        '[Crew Integration] Events:',
        events.map((e) => e.type)
      );
      console.log('[Crew Integration] User response:', (result as { content: string }).content);
    },
    180_000
  );
});
