import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionMiddleware } from '../../../src/middleware/session-middleware.js';
import { SessionStore } from '../../../src/session/session-store.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { AgentMiddleware, StepResult } from '@agentskillmania/colts';

describe('createSessionMiddleware', () => {
  let testBaseDir: string;
  let store: SessionStore;
  let middleware: AgentMiddleware;
  const workspacePath = '/test/workspace';
  const model = 'GLM-4.7';

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-mw-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    store = new SessionStore(testBaseDir, workspacePath);
    middleware = createSessionMiddleware(store, model);
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  it('should have name "session"', () => {
    expect(middleware.name).toBe('session');
  });

  describe('beforeRun', () => {
    it('should create session directory for new state', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });

      await middleware.beforeRun!({ state });

      const exists = await store.existsAsync(state.id);
      expect(exists).toBe(true);
    });

    it('should not recreate session if it already exists', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });

      await store.createWithId(state.id, model);
      const meta1 = await store.getMeta(state.id);

      await middleware.beforeRun!({ state });
      const meta2 = await store.getMeta(state.id);

      expect(meta1!.createdAt).toBe(meta2!.createdAt);
    });

    it('should write user transcript entry', async () => {
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        'Hello'
      );

      await middleware.beforeRun!({ state });

      const dir = store.getSessionDir(state.id);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(transcript.trim());
      expect(parsed.type).toBe('user');
      expect(parsed.content).toBe('Hello');
    });

    it('should stringify non-string user message content', async () => {
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      // Manually push a message with non-string content (array format)
      const nonStringState = {
        ...state,
        context: {
          ...state.context,
          messages: [
            ...state.context.messages,
            {
              role: 'user' as const,
              content: [{ type: 'text', text: 'Hello from array' }],
            },
          ],
        },
      };

      await middleware.beforeRun!({ state: nonStringState });

      const dir = store.getSessionDir(state.id);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(transcript.trim());
      expect(parsed.type).toBe('user');
      expect(parsed.content).toBe(JSON.stringify([{ type: 'text', text: 'Hello from array' }]));
    });
  });

  describe('afterStep', () => {
    it('should write tool transcript entry for continue result', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });
      await store.createWithId(state.id, model);

      const stepResult: StepResult = {
        type: 'continue',
        toolResult: 'file content here',
        actions: [{ id: 'tc1', tool: 'file_read', arguments: { path: 'src/app.ts' } }],
        tokens: { input: 100, output: 50 },
      };

      await middleware.afterStep!({ state, result: stepResult, stepNumber: 0 });

      const dir = store.getSessionDir(state.id);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(transcript.trim());
      expect(parsed.type).toBe('tool');
      expect(parsed.toolName).toBe('file_read');
      expect(parsed.result).toBe('file content here');
    });

    it('should write assistant transcript entry for done result', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });
      await store.createWithId(state.id, model);

      const stepResult: StepResult = {
        type: 'done',
        answer: 'Here is the answer.',
        tokens: { input: 100, output: 50 },
      };

      await middleware.afterStep!({ state, result: stepResult, stepNumber: 0 });

      const dir = store.getSessionDir(state.id);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(transcript.trim());
      expect(parsed.type).toBe('assistant');
      expect(parsed.content).toBe('Here is the answer.');
    });

    it('should stringify non-string toolResult in continue result', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });
      await store.createWithId(state.id, model);

      const stepResult: StepResult = {
        type: 'continue',
        toolResult: { files: ['a.ts', 'b.ts'] },
        actions: [{ id: 'tc1', tool: 'file_list', arguments: { dir: 'src' } }],
        tokens: { input: 100, output: 50 },
      };

      await middleware.afterStep!({ state, result: stepResult, stepNumber: 0 });

      const dir = store.getSessionDir(state.id);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(transcript.trim());
      expect(parsed.type).toBe('tool');
      expect(parsed.result).toBe(JSON.stringify({ files: ['a.ts', 'b.ts'] }));
    });

    it('should handle null toolResult in continue result', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });
      await store.createWithId(state.id, model);

      const stepResult: StepResult = {
        type: 'continue',
        toolResult: null as any,
        actions: [{ id: 'tc1', tool: 'noop', arguments: {} }],
        tokens: { input: 0, output: 0 },
      };

      await middleware.afterStep!({ state, result: stepResult, stepNumber: 0 });

      const dir = store.getSessionDir(state.id);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(transcript.trim());
      expect(parsed.result).toBe('""');
    });

    it('should write error transcript entry for error result', async () => {
      const state = createAgentState({
        name: 'test',
        instructions: 'test',
        tools: [],
      });
      await store.createWithId(state.id, model);

      const stepResult: StepResult = {
        type: 'error',
        error: new Error('LLM call failed'),
        tokens: { input: 0, output: 0 },
      };

      await middleware.afterStep!({ state, result: stepResult, stepNumber: 0 });

      const dir = store.getSessionDir(state.id);
      const transcript = await readFile(join(dir, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(transcript.trim());
      expect(parsed.type).toBe('error');
      expect(parsed.message).toBe('LLM call failed');
    });
  });

  describe('afterRun', () => {
    it('should save state and update meta', async () => {
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        'Hello'
      );
      await store.createWithId(state.id, model);

      const runResult = {
        type: 'success' as const,
        reason: 'done',
        state,
      };

      await middleware.afterRun!({
        state,
        result: runResult as any,
      });

      const loaded = await store.loadState(state.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(state.id);

      const meta = await store.getMeta(state.id);
      expect(meta!.messageCount).toBe(state.context.messages.length);
    });
  });
});
