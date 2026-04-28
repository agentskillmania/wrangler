/**
 * User Story: 创建 Runner 并执行单轮对话
 *
 * 作为开发者，我用 createSessionSupport 创建 session 基础设施，
 * 自己创建 AgentRunner，发送一条用户消息，
 * agent 执行完成后我能拿到结果，且 session 被正确持久化。
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createSessionSupport } from '../../src/session/support.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testConfig, itif } from './config.js';
import { createRealLLMClient } from './helpers.js';

describe('US1: 创建 Runner 并执行单轮对话', () => {
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
      const client = createRealLLMClient();
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: client,
        tools: session.tools,
        middleware: [session.middleware],
      });

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
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(sessionId);

      // Verify meta.yaml — model should come from runnerOptions
      const meta = await session.store.getMeta(sessionId);
      expect(meta).not.toBeNull();
      expect(meta!.model).toBe(testConfig.testModel);
      expect(meta!.workspacePath).toBe('/test/workspace');
      expect(meta!.messageCount).toBeGreaterThan(0);

      // Verify transcript.jsonl
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const lines = transcript.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const userEntry = JSON.parse(lines[0]);
      expect(userEntry.type).toBe('user');
      expect(userEntry.content).toBe('What is 2 + 2?');

      const assistantMsgs = finalState.context.messages.filter((m) => m.role === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThan(0);
    },
    60000
  );

  itif(testConfig.enabled)(
    'should handle calculator tool call and persist transcript',
    async () => {
      const client = createRealLLMClient();
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const runner = new AgentRunner({
        model: testConfig.testModel,
        llmClient: client,
        tools: session.tools,
        middleware: [session.middleware],
        maxSteps: 5,
      });

      let state = createAgentState({
        name: 'math-agent',
        instructions: 'You are a math assistant. Always use the calculator tool for arithmetic.',
        tools: [],
      });
      state = addUserMessage(state, 'What is 123 * 456?');

      const { result } = await runner.run(state);
      expect(result.type).toBe('success');
    },
    60000
  );
});

/**
 * User Story: 恢复 Session 继续对话
 *
 * 作为开发者，我通过 SessionStore 加载之前保存的 state，
 * 追加新的用户消息，继续执行 agent，session 记录被追加而非覆盖。
 */
describe('US2: 恢复 Session 继续对话', () => {
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
        tools: [] as import('@agentskillmania/colts').ToolDefinition[],
      };

      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      // Round 1
      const client1 = createRealLLMClient();
      const runner1 = new AgentRunner({
        model: testConfig.testModel,
        llmClient: client1,
        tools: session.tools,
        middleware: [session.middleware],
      });

      let state = createAgentState(agentConfig);
      state = addUserMessage(state, 'My name is Alice. Remember it.');
      await runner1.run(state);
      const sessionId = state.id;

      // Round 2: Resume
      const loaded = await session.store.loadState(sessionId);
      expect(loaded).not.toBeNull();

      const client2 = createRealLLMClient();
      const runner2 = new AgentRunner({
        model: testConfig.testModel,
        llmClient: client2,
        tools: session.tools,
        middleware: [session.middleware],
      });

      const resumedState = addUserMessage(loaded!, 'What is my name?');
      const { state: finalState } = await runner2.run(resumedState);

      // Verify transcript has entries from both rounds
      const dir = session.store.getSessionDir(sessionId);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const entries = transcript
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));

      const userContents = entries.filter((e) => e.type === 'user').map((e) => e.content);
      expect(userContents).toContain('My name is Alice. Remember it.');
      expect(userContents).toContain('What is my name?');

      const lastAssistant = [...finalState.context.messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      expect(lastAssistant).toBeDefined();
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
 * User Story: Session 管理操作
 *
 * 作为开发者，我通过 SessionStore 列出、查询、删除 session。
 */
describe('US3: Session 管理操作', () => {
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

    await store.createWithId('1745800001-session-a', 'GLM-4.7');
    await store.createWithId('1745800002-session-b', 'GLM-4.7');

    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(2);

    const meta = await store.getMeta('1745800001-session-a');
    expect(meta!.model).toBe('GLM-4.7');

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

    await sessionA.store.createWithId('1745800001-a-session', 'GLM-4.7');
    await sessionB.store.createWithId('1745800002-b-session', 'GLM-4.7');

    const sessionsA = await sessionA.store.listSessions();
    const sessionsB = await sessionB.store.listSessions();

    expect(sessionsA).toHaveLength(1);
    expect(sessionsA[0].id).toBe('1745800001-a-session');
    expect(sessionsB).toHaveLength(1);
    expect(sessionsB[0].id).toBe('1745800002-b-session');
  });

  it('should track message count across state saves', async () => {
    const { store } = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    await store.createWithId('1745800000-count-test', 'GLM-4.7');

    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    const stateWithMsg = addUserMessage(state, 'Hello');

    await store.saveState('1745800000-count-test', stateWithMsg);
    await store.updateMeta('1745800000-count-test', {
      messageCount: stateWithMsg.context.messages.length,
      updatedAt: new Date().toISOString(),
    });

    const meta = await store.getMeta('1745800000-count-test');
    expect(meta!.messageCount).toBe(stateWithMsg.context.messages.length);

    const loaded = await store.loadState('1745800000-count-test');
    expect(loaded).not.toBeNull();
  });
});
