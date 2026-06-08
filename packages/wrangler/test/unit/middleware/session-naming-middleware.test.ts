import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionNamingMiddleware } from '../../../src/middleware/session-naming-middleware.js';
import { SessionStore } from '../../../src/session/session-store.js';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';
import type { AgentMiddleware, StepResult, RunnerOptions, ILLMProvider } from '@agentskillmania/colts';

const mockRunnerOptions: Readonly<RunnerOptions> = {
  model: 'GLM-4.7',
  maxSteps: 10,
};

function createMockLLM(responseContent: string): ILLMProvider {
  return {
    call: vi.fn().mockResolvedValue({ content: responseContent, role: 'assistant' }),
    stream: vi.fn(),
    getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
  } as unknown as ILLMProvider;
}

describe('createSessionNamingMiddleware', () => {
  let testBaseDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-naming-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    store = new SessionStore(testBaseDir, '/test/workspace');
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('should have name "session-naming"', () => {
    const mw = createSessionNamingMiddleware({ store });
    expect(mw.name).toBe('session-naming');
  });

  describe('Phase 1 — beforeRun', () => {
    it('should set title from first user message when session has no title', async () => {
      const mw = createSessionNamingMiddleware({ store });
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Write a hello world program in TypeScript');

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await mw.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Write a hello world program in TypeScript');
      expect(meta!.titleSource).toBe('auto');
    });

    it('should truncate long title to 60 chars', async () => {
      const mw = createSessionNamingMiddleware({ store });
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'a'.repeat(200));

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await mw.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      expect(meta!.title!.length).toBeLessThanOrEqual(60);
      expect(meta!.titleSource).toBe('auto');
    });

    it('should not overwrite existing title', async () => {
      const mw = createSessionNamingMiddleware({ store });
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Second message');

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'First Title', titleSource: 'auto' });

      await mw.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('First Title');
    });

    it('should skip when no user message exists', async () => {
      const mw = createSessionNamingMiddleware({ store });
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await mw.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBeUndefined();
    });

    it('should skip when session does not exist', async () => {
      const mw = createSessionNamingMiddleware({ store });
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');

      // Session not created — getMeta returns null
      await mw.beforeRun!({ state, runnerOptions: mockRunnerOptions });

      const exists = await store.existsAsync(state.id);
      expect(exists).toBe(false);
    });
  });

  describe('Phase 2 — afterStep', () => {
    it('should upgrade title via LLM on done result', async () => {
      const mockLLM = createMockLLM('Generated Session Title');
      const mw = createSessionNamingMiddleware({ store, llmClient: mockLLM, model: 'GLM-5.1' });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Write hello world');
      state = addAssistantMessage(state, 'Here is the hello world program');

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Write hello world', titleSource: 'auto' });

      const stepResult: StepResult = {
        type: 'done',
        answer: 'Here is the hello world program',
        tokens: { input: 100, output: 50 },
      };
      await mw.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Generated Session Title');
      expect(meta!.titleSource).toBe('generated');
      expect(mockLLM.call).toHaveBeenCalledOnce();
    });

    it('should not trigger if titleSource is generated', async () => {
      const mockLLM = createMockLLM('Should not be used');
      const mw = createSessionNamingMiddleware({ store, llmClient: mockLLM, model: 'GLM-5.1' });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Write hello world');
      state = addAssistantMessage(state, 'Here is the program');

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Already Good', titleSource: 'generated' });

      const stepResult: StepResult = {
        type: 'done',
        answer: 'Here is the program',
        tokens: { input: 100, output: 50 },
      };
      await mw.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Already Good');
      expect(meta!.titleSource).toBe('generated');
      expect(mockLLM.call).not.toHaveBeenCalled();
    });

    it('should not trigger if titleSource is manual', async () => {
      const mockLLM = createMockLLM('Should not be used');
      const mw = createSessionNamingMiddleware({ store, llmClient: mockLLM, model: 'GLM-5.1' });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Write hello world');
      state = addAssistantMessage(state, 'Here is the program');

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'User Set', titleSource: 'manual' });

      const stepResult: StepResult = {
        type: 'done',
        answer: 'Here is the program',
        tokens: { input: 100, output: 50 },
      };
      await mw.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('User Set');
      expect(meta!.titleSource).toBe('manual');
      expect(mockLLM.call).not.toHaveBeenCalled();
    });

    it('should skip if no llmClient provided', async () => {
      const mw = createSessionNamingMiddleware({ store });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Write hello world');
      state = addAssistantMessage(state, 'Here is the program');

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Write hello world', titleSource: 'auto' });

      const stepResult: StepResult = {
        type: 'done',
        answer: 'Here is the program',
        tokens: { input: 100, output: 50 },
      };
      await mw.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Write hello world');
      expect(meta!.titleSource).toBe('auto');
    });

    it('should handle LLM errors gracefully', async () => {
      const mockLLM = {
        call: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
        stream: vi.fn(),
        getModelMeta: vi.fn().mockReturnValue({ contextWindow: 128000, maxTokens: 4096 }),
      } as unknown as ILLMProvider;

      const mw = createSessionNamingMiddleware({ store, llmClient: mockLLM, model: 'GLM-5.1' });

      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Write hello world');
      state = addAssistantMessage(state, 'Here is the program');

      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Write hello world', titleSource: 'auto' });

      const stepResult: StepResult = {
        type: 'done',
        answer: 'Here is the program',
        tokens: { input: 100, output: 50 },
      };
      await mw.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      const meta = await store.getMeta(state.id);
      expect(meta!.title).toBe('Write hello world');
      expect(meta!.titleSource).toBe('auto');
    });

    it('should not trigger on continue result', async () => {
      const mockLLM = createMockLLM('Should not be used');
      const mw = createSessionNamingMiddleware({ store, llmClient: mockLLM, model: 'GLM-5.1' });

      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Write hello world', titleSource: 'auto' });

      const stepResult: StepResult = {
        type: 'continue',
        toolResult: 'ok',
        actions: [{ id: 'tc1', tool: 'file_read', arguments: { path: 'a.ts' } }],
        tokens: { input: 100, output: 50 },
      };
      await mw.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });

      expect(mockLLM.call).not.toHaveBeenCalled();
    });

    it('should not trigger on error result', async () => {
      const mockLLM = createMockLLM('Should not be used');
      const mw = createSessionNamingMiddleware({ store, llmClient: mockLLM, model: 'GLM-5.1' });

      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await store.createWithId(state.id, 'GLM-4.7', 'test');
      await store.updateMeta(state.id, { title: 'Write hello world', titleSource: 'auto' });

      const stepResult: StepResult = {
        type: 'error',
        error: new Error('LLM failed'),
        tokens: { input: 0, output: 0 },
      };
      await mw.afterStep!({
        state,
        result: stepResult,
        stepNumber: 0,
        runnerOptions: mockRunnerOptions,
      });

      expect(mockLLM.call).not.toHaveBeenCalled();
    });
  });
});
