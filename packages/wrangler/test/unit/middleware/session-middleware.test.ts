import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionMiddleware } from '../../../src/middleware/session-middleware.js';
import { SessionStore } from '../../../src/session/session-store.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';
import type { AgentMiddleware, StepResult, RunnerOptions } from '@agentskillmania/colts';
import type { SessionEntry } from '../../../src/session/types.js';

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
    middleware = createSessionMiddleware({ store });
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
      await store.createWithId(state.id, 'GLM-4.7', 'test');
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

    it('should create session and record user message with colts id', async () => {
      let state = createAgentState({ name: 'test-agent', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello agent');
      await middleware.beforeRun!({
        state,
        runnerOptions: mockRunnerOptions,
      });

      expect(await store.existsAsync(state.id)).toBe(true);
      const entries = await store.readEntries(state.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].role).toBe('user');
      expect(entries[0].content).toBe('Hello agent');
      expect(entries[0].id).toBe(state.context.messages[0].id);
    });

    it('should store agentName in SessionMeta', async () => {
      const state = createAgentState({ name: 'my-agent', instructions: 'test', tools: [] });
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const meta = await store.getMeta(state.id);
      expect(meta!.agentName).toBe('my-agent');
    });

    it('should not record user entry when no user messages exist', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const entries = await store.readEntries(state.id);
      expect(entries).toHaveLength(0);
    });
  });

  describe('Phase 1 — initial title from first user message', () => {
    it('should set initial title from first user message on new session', async () => {
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'How do I build a REST API with Express?');
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('How do I build a REST API with Express?');
    });

    it('should truncate long user messages for initial title', async () => {
      const longMsg =
        'This is a very long message that exceeds the maximum title length limit and should be truncated to fit within the constraints of the title field properly';
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, longMsg);
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBeDefined();
      expect(meta!.title!.length).toBeLessThanOrEqual(50);
    });

    it('should not update title on existing session (subsequent run)', async () => {
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'First message');
      // Pre-create the session so beforeRun skips creation
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Existing Title' });

      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      // Title should remain unchanged because the session already existed
      expect(meta!.title).toBe('Existing Title');
    });

    it('should set title to "Untitled" for empty user message', async () => {
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, '');
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Untitled');
    });
  });

  describe('afterStep', () => {
    it('should write tool SessionEntry for continue result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
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
      const entries = await store.readEntries(state.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].role).toBe('tool');
      expect(entries[0].toolName).toBe('file_read');
      expect(entries[0].content).toBe('file content here');
      expect(entries[0].toolArguments).toBe(JSON.stringify({ path: 'src/app.ts' }));
      expect(entries[0].id).toBeDefined();
    });

    it('should write assistant SessionEntry for done result', async () => {
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      state = addAssistantMessage(state, 'previous response');
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
      const entries = await store.readEntries(state.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].role).toBe('assistant');
      expect(entries[0].content).toBe('Here is the answer.');
      const lastMsg = state.context.messages.filter((m) => m.role === 'assistant').at(-1);
      expect(entries[0].id).toBe(lastMsg!.id);
    });

    it('should write assistant entry with random UUID when no assistant message in state', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      const stepResult: StepResult = {
        type: 'done',
        answer: 'Short answer.',
        tokens: { input: 100, output: 50 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const entries = await store.readEntries(state.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].role).toBe('assistant');
      expect(entries[0].id).toBeDefined();
    });

    it('should write error SessionEntry for error result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
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
      const entries = await store.readEntries(state.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].role).toBe('error');
      expect(entries[0].errorMessage).toBe('LLM call failed');
      expect(entries[0].content).toBe('LLM call failed');
      expect(entries[0].id).toBeDefined();
    });

    it('should stringify non-string toolResult in continue result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
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
      const entries = await store.readEntries(state.id);
      expect(entries[0].content).toBe(JSON.stringify({ files: ['a.ts', 'b.ts'] }));
    });

    it('should handle null toolResult in continue result', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      const stepResult: StepResult = {
        type: 'continue',
        toolResult: null as unknown as string,
        actions: [{ id: 'tc1', tool: 'noop', arguments: {} }],
        tokens: { input: 0, output: 0 },
      };
      await middleware.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });
      const entries = await store.readEntries(state.id);
      expect(entries[0].content).toBe('""');
    });

    it('should write multiple entries for multiple actions', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
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
      const entries = await store.readEntries(state.id);
      expect(entries).toHaveLength(2);
      expect(entries[0].toolName).toBe('file_read');
      expect(entries[1].toolName).toBe('file_read');
    });
  });

  describe('afterRun', () => {
    it('should save state and update meta', async () => {
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        'Hello'
      );
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await middleware.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });
      const loaded = await store.loadState(state.id);
      expect(loaded!.id).toBe(state.id);
      const meta = await store.getMeta(state.id);
      expect(typeof meta!.updatedAt).toBe('string');
      expect(meta!.updatedAt.length).toBeGreaterThan(0);
    });
  });

  describe('Phase 2 — LLM title upgrade', () => {
    it('should upgrade title via LLM when stepCount <= 1 and title is Untitled', async () => {
      const execute = vi.fn().mockResolvedValue('REST API Building Guide');
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, '');
      // stepCount defaults to 0 in createAgentState
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Untitled' });

      // Add assistant message so the LLM prompt has content
      state = addAssistantMessage(state, 'Here is how you build a REST API...');

      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      expect(execute).toHaveBeenCalledTimes(1);
      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('REST API Building Guide');
    });

    it('should upgrade title via LLM when stepCount <= 1 and title is missing', async () => {
      const execute = vi.fn().mockResolvedValue('Express Tutorial');
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'How do I use Express?');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      // Do not set title — it will be undefined

      state = addAssistantMessage(state, 'Express is a web framework...');

      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      expect(execute).toHaveBeenCalledTimes(1);
      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Express Tutorial');
    });

    it('should strip quotes from LLM response', async () => {
      const execute = vi.fn().mockResolvedValue('"REST API Guide"');
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, '');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Untitled' });
      state = addAssistantMessage(state, 'response');

      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('REST API Guide');
    });

    it('should skip Phase 2 when stepCount > 1', async () => {
      const execute = vi.fn().mockResolvedValue('Should not be called');
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Untitled' });
      state = addAssistantMessage(state, 'Hi there');

      // Manually bump stepCount to simulate multi-step run
      state = { ...state, context: { ...state.context, stepCount: 5 } };

      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      expect(execute).not.toHaveBeenCalled();
    });

    it('should skip Phase 2 when llmClient is not provided', async () => {
      // middleware created without llmClient (default behavior)
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Untitled' });
      state = addAssistantMessage(state, 'Hi there');

      await middleware.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      // Title should remain Untitled — no LLM upgrade
      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Untitled');
    });

    it('should not crash when LLM execute throws', async () => {
      const execute = vi.fn().mockRejectedValue(new Error('LLM timeout'));
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Untitled' });
      state = addAssistantMessage(state, 'Hi there');

      // Should not throw
      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      // Title should remain unchanged after error
      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Untitled');
    });

    it('should skip Phase 2 when title is already set and not Untitled', async () => {
      const execute = vi.fn().mockResolvedValue('Should not be called');
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'My Custom Title' });
      state = addAssistantMessage(state, 'Hi there');

      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      expect(execute).not.toHaveBeenCalled();
      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('My Custom Title');
    });

    it('should skip Phase 2 when no assistant message exists', async () => {
      const execute = vi.fn().mockResolvedValue('Should not be called');
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Untitled' });
      // No assistant message added

      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      expect(execute).not.toHaveBeenCalled();
    });

    it('should not update title when LLM returns empty string', async () => {
      const execute = vi.fn().mockResolvedValue('   ');
      const mw = createSessionMiddleware({ store, llmClient: { execute } });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Untitled' });
      state = addAssistantMessage(state, 'Hi there');

      await mw.afterRun!({
        state,
        result: { type: 'completed', reason: 'done', state } as unknown as never,
        runnerOptions: mockRunnerOptions,
      });

      const meta = await store.getMeta(state.id);
      // Title should remain Untitled because LLM returned whitespace-only
      expect(meta!.title).toBe('Untitled');
    });
  });
});
