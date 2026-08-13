/**
 * US2: SessionStore conversation persistence model
 *
 * state.json (full AgentState snapshot) is the sole conversation
 * persistence mechanism. session-middleware saves the snapshot in
 * afterRun; session.jsonl / SessionEntry have been removed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionSupport } from '../../src/session/support.js';
import { defaultNodeHostEnv } from '../../src/host-env/node-host-env.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';

function makeRunner(tools: unknown[], middleware: unknown[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llmClient: LLMClient.quickInit({
      providers: [
        {
          name: testConfig.provider,
          apiKey: testConfig.apiKey,
          baseUrl: testConfig.baseUrl,
          models: [{ modelId: testConfig.testModel }],
        },
      ],
    }),
    tools,
    middleware,
  });
}

describe('US2: SessionStore conversation model', () => {
  let testBaseDir: string;

  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(`[Layer5 US2] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`);
    }
  });

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-l5us2-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  describe('appendEntry / readEntries', () => {
    // NOTE: session.jsonl persistence was deleted from SessionStore.
    // appendEntry / readEntries no longer exist; state.json (full AgentState
    // snapshot) is now the sole conversation persistence mechanism.
    // The integration test below (saveState/loadState) covers this contract.
    it('saves and loads AgentState via state.json', async () => {
      const session = createSessionSupport({ runtime: defaultNodeHostEnv,
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const sessionId = '1745800000-conv-test';
      await session.store.createWithId(sessionId, 'test-model', 'test-agent');

      const state = createAgentState({ name: 'test-agent', tools: [] });
      await session.store.saveState(sessionId, state);

      const loaded = await session.store.loadState(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(state.id);
    });

    it('returns null for non-existent session on loadState', async () => {
      const session = createSessionSupport({ runtime: defaultNodeHostEnv,
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const loaded = await session.store.loadState('nonexistent');
      expect(loaded).toBeNull();
    });
  });

  itif(testConfig.enabled)(
    'session-middleware saves AgentState to state.json on agent run',
    async () => {
      const session = createSessionSupport({ runtime: defaultNodeHostEnv,
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const runner = makeRunner(session.tools, session.middlewares);

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant. Answer in one short sentence.',
        tools: [],
      });
      state = addUserMessage(state, 'What is the capital of France?');

      await runner.run(state);

      const sessionId = state.id;

      // session-middleware persists state via state.json in afterRun.
      const loaded = await session.store.loadState(sessionId);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(sessionId);
      expect(loaded!.context.messages.length).toBeGreaterThanOrEqual(2);

      // meta should also be present with agentName + updatedAt.
      const meta = await session.store.getMeta(sessionId);
      expect(meta).not.toBeNull();
      expect(meta!.agentName).toBe('test-agent');
      expect(typeof meta!.updatedAt).toBe('string');
    },
    120000
  );
});
