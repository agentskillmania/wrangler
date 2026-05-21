import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionMiddleware } from '../../../src/middleware/session-middleware.js';
import { SessionStore } from '../../../src/session/session-store.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { AgentMiddleware, StepResult, RunnerOptions } from '@agentskillmania/colts';

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

describe('createSessionMiddleware', () => {
  let testBaseDir: string;
  let store: SessionStore;
  let middleware: AgentMiddleware;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-mw-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    store = new SessionStore(testBaseDir, '/test/workspace');
    middleware = createSessionMiddleware(store);
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('should have name "session"', () => {
    expect(middleware.name).toBe('session');
  });

  describe('beforeRun', () => {
    it('should create session directory for new state', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const exists = await store.existsAsync(state.id);
      expect(exists).toBe(true);
    });

    it('should not recreate session if it already exists', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7');
      const meta1 = await store.getMeta(state.id);
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const meta2 = await store.getMeta(state.id);
      expect(meta1!.createdAt).toBe(meta2!.createdAt);
    });

    it('should use model from runnerOptions for meta', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const meta = await store.getMeta(state.id);
      expect(meta!.model).toBe('GLM-4.7');
    });
  });

  describe('afterStep', () => {
    it('should write tool ConversationMessage for continue result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7');
      const stepResult: StepResult = {
        type: 'continue',
        toolResult: 'file content here',
        actions: [{ id: 'tc1', tool: 'file_read', arguments: { path: 'src/app.ts' } }],
        tokens: { input: 100, output: 50 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const messages = await store.readConversation(state.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('tool');
      expect(messages[0].toolName).toBe('file_read');
      expect(messages[0].content).toBe('file content here');
      expect(messages[0].toolArguments).toBe(JSON.stringify({ path: 'src/app.ts' }));
    });

    it('should write assistant ConversationMessage for done result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7');
      const stepResult: StepResult = {
        type: 'done',
        answer: 'Here is the answer.',
        tokens: { input: 100, output: 50 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const messages = await store.readConversation(state.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('Here is the answer.');
    });

    it('should write error ConversationMessage for error result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7');
      const stepResult: StepResult = {
        type: 'error',
        error: new Error('LLM call failed'),
        tokens: { input: 0, output: 0 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const messages = await store.readConversation(state.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('error');
      expect(messages[0].errorMessage).toBe('LLM call failed');
      expect(messages[0].content).toBe('LLM call failed');
    });

    it('should stringify non-string toolResult in continue result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7');
      const stepResult: StepResult = {
        type: 'continue',
        toolResult: { files: ['a.ts', 'b.ts'] },
        actions: [{ id: 'tc1', tool: 'file_list', arguments: { dir: 'src' } }],
        tokens: { input: 100, output: 50 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const messages = await store.readConversation(state.id);
      expect(messages[0].content).toBe(JSON.stringify({ files: ['a.ts', 'b.ts'] }));
    });

    it('should handle null toolResult in continue result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7');
      const stepResult: StepResult = {
        type: 'continue',
        toolResult: null as any,
        actions: [{ id: 'tc1', tool: 'noop', arguments: {} }],
        tokens: { input: 0, output: 0 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const messages = await store.readConversation(state.id);
      expect(messages[0].content).toBe('""');
    });

    it('should write multiple messages for multiple actions', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7');
      const stepResult: StepResult = {
        type: 'continue',
        toolResult: 'ok',
        actions: [
          { id: 'tc1', tool: 'file_read', arguments: { path: 'a.ts' } },
          { id: 'tc2', tool: 'file_read', arguments: { path: 'b.ts' } },
        ],
        tokens: { input: 100, output: 50 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const messages = await store.readConversation(state.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].toolName).toBe('file_read');
      expect(messages[1].toolName).toBe('file_read');
    });
  });

  describe('afterRun', () => {
    it('should save state and update meta', async () => {
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        'Hello'
      );
      await store.createWithId(state.id, 'GLM-4.7');
      await middleware.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as any,
        runnerOptions: mockRunnerOptions,
      });
      const loaded = await store.loadState(state.id);
      expect(loaded!.id).toBe(state.id);
      const meta = await store.getMeta(state.id);
      expect(typeof meta!.updatedAt).toBe('string');
      expect(meta!.updatedAt.length).toBeGreaterThan(0);
    });
  });
});
