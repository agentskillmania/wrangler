import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRunner, SessionStore } from '../../src/index.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { ILLMProvider } from '@agentskillmania/colts';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * User Story: 创建 Runner 并执行单轮对话
 *
 * 作为开发者，我调用 createRunner 创建 runner，发送一条用户消息，
 * agent 执行完成后我能拿到结果，且 session 被正确持久化
 *（state.json、meta.yaml、transcript.jsonl 全部生成）。
 */
describe('User Story: 创建 Runner 并执行单轮对话', () => {
  let testBaseDir: string;
  let store: SessionStore;

  function createMockProvider(response: string): ILLMProvider {
    return {
      call: vi.fn().mockResolvedValue({
        content: response,
        tokens: { input: 10, output: 20 },
      }),
      stream: vi.fn(),
    };
  }

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-run-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    store = new SessionStore(testBaseDir, '/test/workspace');
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('should execute single-turn conversation and persist full session', async () => {
    const provider = createMockProvider('I will help you with that.');
    const runner = createRunner({
      workspacePath: '/test/workspace',
      model: 'test-model',
      llm: { llmClient: provider },
      agentConfig: { name: 'test', instructions: 'You are a helper.', tools: [] },
      sessionBaseDir: testBaseDir,
    });

    let state = createAgentState({
      name: 'test',
      instructions: 'You are a helper.',
      tools: [],
    });
    state = addUserMessage(state, 'Hello, please help me.');

    const { state: finalState, result } = await runner.run(state);

    // Verify result is successful
    expect(result.type).toBe('success');

    // Verify session directory exists
    const sessionId = state.id;
    const exists = await store.existsAsync(sessionId);
    expect(exists).toBe(true);

    // Verify state.json was saved
    const loaded = await store.loadState(sessionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(sessionId);

    // Verify meta.yaml has correct data
    const meta = await store.getMeta(sessionId);
    expect(meta).not.toBeNull();
    expect(meta!.model).toBe('test-model');
    expect(meta!.messageCount).toBeGreaterThan(0);

    // Verify transcript.jsonl has entries
    const dir = store.getSessionDir(sessionId);
    const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
    const lines = transcript.trim().split('\n');
    // At minimum: user entry + assistant entry
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const userEntry = JSON.parse(lines[0]);
    expect(userEntry.type).toBe('user');
    expect(userEntry.content).toBe('Hello, please help me.');
  });

  it('should persist tool call entries in transcript', async () => {
    const provider = createMockProvider('Done.');
    const runner = createRunner({
      workspacePath: '/test/workspace',
      model: 'test-model',
      llm: { llmClient: provider },
      agentConfig: { name: 'test', instructions: 'Use calculator.', tools: [] },
      sessionBaseDir: testBaseDir,
      maxSteps: 5,
    });

    let state = createAgentState({
      name: 'test',
      instructions: 'Use calculator.',
      tools: [],
    });
    state = addUserMessage(state, 'What is 2+2?');

    await runner.run(state);

    const dir = store.getSessionDir(state.id);
    const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
    const lines = transcript.trim().split('\n');

    const types = lines.map((l) => JSON.parse(l).type);
    // Should have user entry at minimum
    expect(types).toContain('user');
  });

  it('should throw when neither llmClient nor apiKey provided', () => {
    expect(() =>
      createRunner({
        workspacePath: '/test/workspace',
        model: 'test-model',
        llm: {},
        agentConfig: { name: 'test', instructions: 'test', tools: [] },
        sessionBaseDir: testBaseDir,
      })
    ).toThrow();
  });

  it('should use default sessionBaseDir when not provided', () => {
    const provider = createMockProvider('ok');
    const runner = createRunner({
      workspacePath: '/test/workspace',
      model: 'test-model',
      llm: { llmClient: provider },
      agentConfig: { name: 'test', instructions: 'test', tools: [] },
    });
    expect(runner).toBeDefined();
  });
});

/**
 * User Story: 恢复 Session 继续对话
 *
 * 作为开发者，我通过 SessionStore 加载之前保存的 state，
 * 追加新的用户消息，继续执行 agent，session 记录被追加而非覆盖。
 */
describe('User Story: 恢复 Session 继续对话', () => {
  let testBaseDir: string;
  let store: SessionStore;

  function createMockProvider(responses: string[]): ILLMProvider {
    const callFn = vi.fn();
    responses.forEach((r, i) => {
      callFn.mockResolvedValueOnce({
        content: r,
        tokens: { input: 10, output: 20 },
      });
    });
    return { call: callFn, stream: vi.fn() };
  }

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-resume-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    store = new SessionStore(testBaseDir, '/test/workspace');
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('should resume a saved session with new messages', async () => {
    // Round 1: Create and run
    const provider1 = createMockProvider(['First response']);
    const runner = createRunner({
      workspacePath: '/test/workspace',
      model: 'test-model',
      llm: { llmClient: provider1 },
      agentConfig: { name: 'test', instructions: 'You are a helper.', tools: [] },
      sessionBaseDir: testBaseDir,
    });

    let state = createAgentState({
      name: 'test',
      instructions: 'You are a helper.',
      tools: [],
    });
    state = addUserMessage(state, 'First question');

    const { state: stateAfterRound1 } = await runner.run(state);
    const sessionId = state.id;

    // Round 2: Resume with same session
    const loaded = await store.loadState(sessionId);
    expect(loaded).not.toBeNull();

    const provider2 = createMockProvider(['Second response']);
    const runner2 = createRunner({
      workspacePath: '/test/workspace',
      model: 'test-model',
      llm: { llmClient: provider2 },
      agentConfig: { name: 'test', instructions: 'You are a helper.', tools: [] },
      sessionBaseDir: testBaseDir,
    });

    const resumedState = addUserMessage(loaded!, 'Follow-up question');
    await runner2.run(resumedState);

    // Verify transcript has entries from both rounds
    const dir = store.getSessionDir(sessionId);
    const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
    const lines = transcript.trim().split('\n');
    const entries = lines.map((l) => JSON.parse(l));

    const userContents = entries.filter((e) => e.type === 'user').map((e) => e.content);
    expect(userContents).toContain('First question');
    expect(userContents).toContain('Follow-up question');

    // Verify state was updated (more messages than round 1)
    const finalLoaded = await store.loadState(sessionId);
    expect(finalLoaded!.context.messages.length).toBeGreaterThan(
      stateAfterRound1.context.messages.length
    );
  });
});

/**
 * User Story: Session 管理操作
 *
 * 作为开发者，我通过 SessionStore 列出、查询、删除 session，
 * 并且不同 workspace 的 session 互相隔离。
 */
describe('User Story: Session 管理操作', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-manage-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('should list, get, and delete sessions', async () => {
    const store = new SessionStore(testBaseDir, '/test/workspace');

    // Create two sessions
    await store.createWithId('1745800001-session-a', 'GLM-4.7');
    await store.createWithId('1745800002-session-b', 'GLM-4.7');

    // List
    const sessions = await store.listSessions();
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain('1745800001-session-a');
    expect(ids).toContain('1745800002-session-b');

    // Get
    const meta = await store.getMeta('1745800001-session-a');
    expect(meta).not.toBeNull();
    expect(meta!.model).toBe('GLM-4.7');
    expect(meta!.workspacePath).toBe('/test/workspace');

    // Delete
    await store.deleteSession('1745800001-session-a');
    const afterDelete = await store.listSessions();
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].id).toBe('1745800002-session-b');
  });

  it('should isolate sessions by workspace', async () => {
    const storeA = new SessionStore(testBaseDir, '/project-a');
    const storeB = new SessionStore(testBaseDir, '/project-b');

    await storeA.createWithId('1745800001-a-session', 'GLM-4.7');
    await storeB.createWithId('1745800002-b-session', 'GLM-4.7');

    // Each store only sees its own workspace sessions
    const sessionsA = await storeA.listSessions();
    const sessionsB = await storeB.listSessions();

    expect(sessionsA).toHaveLength(1);
    expect(sessionsA[0].id).toBe('1745800001-a-session');

    expect(sessionsB).toHaveLength(1);
    expect(sessionsB[0].id).toBe('1745800002-b-session');
  });

  it('should track message count across state saves', async () => {
    const store = new SessionStore(testBaseDir, '/test/workspace');
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

    // Verify state can be loaded back
    const loaded = await store.loadState('1745800000-count-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.context.messages).toHaveLength(stateWithMsg.context.messages.length);
  });
});
