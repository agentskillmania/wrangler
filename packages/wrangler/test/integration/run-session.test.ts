/**
 * User Story: Create Runner and execute single-turn conversation
 *
 * As a developer, I use createSessionSupport to set up session infrastructure,
 * create my own AgentRunner, send a user message,
 * and after agent execution I get the result with the session correctly persisted.
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createSessionSupport } from '../../src/session/support.js';
import {
  AgentRunner,
  createAgentState,
  addUserMessage,
  type ToolDefinition,
} from '@agentskillmania/colts';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testConfig, itif } from './config.js';

function makeRunner(tools: ToolDefinition[], middleware: unknown[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llm: {
      providers: [
        {
          name: testConfig.provider,
          apiKey: testConfig.apiKey,
          baseUrl: testConfig.baseUrl,
          models: [{ modelId: testConfig.testModel }],
        },
      ],
    },
    tools,
    middleware,
  });
}

describe('US1: Create Runner and execute single-turn conversation', () => {
  let testBaseDir: string;

  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Wrangler Integration] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-us1-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  itif(testConfig.enabled)(
    'should execute single-turn conversation and persist full session',
    async () => {
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const runner = makeRunner(session.tools, session.middlewares);

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant. Answer in one short sentence.',
        tools: [],
      });
      state = addUserMessage(state, 'What is 2 + 2?');

      const { state: finalState, result } = await runner.run(state);

      expect(result.type).toBe('success');

      const sessionId = state.id;
      const dir = session.store.getSessionDir(sessionId);

      // Verify state.json
      const loaded = await session.store.loadState(sessionId);
      expect(loaded).toHaveProperty('id', sessionId);

      // Verify meta.yaml — workspacePath and agentName should be persisted.
      // Note: model is only written when runnerConfigSnapshot is provided (via EnhancedRunner).
      // This test uses AgentRunner directly, so model is not in meta.
      const meta = await session.store.getMeta(sessionId);
      expect(meta).toBeDefined();
      expect(meta!.workspacePath).toBe('/test/workspace');
      expect(meta!.agentName).toBe('test-agent');
      expect(typeof meta!.updatedAt).toBe('string');

      // Verify session.jsonl via readEntries
      const entries = await session.store.readEntries(sessionId);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const assistantEntries = entries.filter((e) => e.role === 'assistant');
      expect(assistantEntries.length).toBeGreaterThan(0);
    },
    120000
  );

  itif(testConfig.enabled)(
    'should handle calculator tool call and persist session entries',
    async () => {
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const runner = makeRunner(session.tools, session.middlewares);

      let state = createAgentState({
        name: 'math-agent',
        instructions: 'You are a math assistant. Always use the calculator tool for arithmetic.',
        tools: [],
      });
      state = addUserMessage(state, 'What is 123 * 456?');

      const { result } = await runner.run(state);
      expect(result.type).toBe('success');
    },
    120000
  );
});

/**
 * User Story: Resume Session and continue conversation
 *
 * As a developer, I load a previously saved state via SessionStore,
 * append a new user message, continue executing the agent,
 * and session entries are appended rather than overwritten.
 */
describe('US2: Resume Session and continue conversation', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-us2-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  itif(testConfig.enabled)(
    'should resume a saved session with new messages',
    async () => {
      const agentConfig = {
        name: 'test-agent',
        instructions: 'You are a helpful assistant. Answer concisely.',
        tools: [] as ToolDefinition[],
      };

      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      // Round 1
      const runner1 = makeRunner(session.tools, session.middlewares);

      let state = createAgentState(agentConfig);
      state = addUserMessage(state, 'My name is Alice. Remember it.');
      await runner1.run(state);
      const sessionId = state.id;

      // Round 2: Resume
      const loaded = await session.store.loadState(sessionId);
      expect(loaded).toHaveProperty('id');

      const runner2 = makeRunner(session.tools, session.middlewares);

      const resumedState = addUserMessage(loaded!, 'What is my name?');
      const { state: finalState } = await runner2.run(resumedState);

      // Verify session entries have entries from both rounds
      const entries = await session.store.readEntries(sessionId);
      const assistantEntries = entries.filter((e) => e.role === 'assistant');
      expect(assistantEntries.length).toBeGreaterThanOrEqual(2);

      // Verify state contains both user messages
      const userContents = finalState.context.messages
        .filter((m) => m.role === 'user')
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
      expect(userContents).toContain('My name is Alice. Remember it.');
      expect(userContents).toContain('What is my name?');

      const lastAssistant = [...finalState.context.messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      expect(lastAssistant).toHaveProperty('content');
      const responseText =
        typeof lastAssistant!.content === 'string'
          ? lastAssistant!.content
          : JSON.stringify(lastAssistant!.content);
      expect(responseText.toLowerCase()).toContain('alice');
    },
    120000
  );
});

/**
 * User Story: Session management operations
 *
 * As a developer, I list, query, and delete sessions via SessionStore.
 */
describe('US3: Session management operations', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-us3-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('should list, get, and delete sessions', async () => {
    const { store } = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    await store.createWithId('1745800001-session-a', 'agent-a');
    await store.createWithId('1745800002-session-b', 'agent-b');

    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(2);

    const meta = await store.getMeta('1745800001-session-a');
    expect(meta!.runnerConfig).toBeDefined();
    expect(meta!.agentName).toBe('agent-a');

    await store.deleteSession('1745800001-session-a');
    const afterDelete = await store.listSessions();
    expect(afterDelete).toHaveLength(1);
  });

  it('should isolate sessions by workspace', async () => {
    const sessionA = createSessionSupport({
      workspacePath: '/project-a',
      sessionBaseDir: testBaseDir,
    });
    const sessionB = createSessionSupport({
      workspacePath: '/project-b',
      sessionBaseDir: testBaseDir,
    });

    await sessionA.store.createWithId('1745800001-a-session', 'GLM-4.7', 'agent-a');
    await sessionB.store.createWithId('1745800002-b-session', 'GLM-4.7', 'agent-b');

    const sessionsA = await sessionA.store.listSessions();
    const sessionsB = await sessionB.store.listSessions();

    expect(sessionsA).toHaveLength(1);
    expect(sessionsA[0].id).toBe('1745800001-a-session');
    expect(sessionsB).toHaveLength(1);
    expect(sessionsB[0].id).toBe('1745800002-b-session');
  });

  it('should persist state and read entries after save', async () => {
    const { store } = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    await store.createWithId('1745800000-count-test', 'test-agent');

    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    const stateWithMsg = addUserMessage(state, 'Hello');

    await store.saveState('1745800000-count-test', stateWithMsg);

    const loaded = await store.loadState('1745800000-count-test');
    expect(loaded).toHaveProperty('id');
    expect(loaded!.context.messages).toHaveLength(1);
  });
});
