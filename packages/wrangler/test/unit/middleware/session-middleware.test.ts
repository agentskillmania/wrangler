import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionMiddleware } from '../../../src/middleware/session-middleware.js';
import { SessionStore } from '../../../src/session/session-store.js';
import { NodeHostEnv } from '../../../src/host-env/node-host-env.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { AgentMiddleware, RunnerOptions } from '@agentskillmania/colts';

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
    store = new SessionStore(testBaseDir, '/test/workspace', new NodeHostEnv());
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
      await store.createWithId(state.id, 'test');
      const meta1 = await store.getMeta(state.id);
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const meta2 = await store.getMeta(state.id);
      expect(meta1!.createdAt).toBe(meta2!.createdAt);
    });

    it('should persist runnerConfig snapshot to meta', async () => {
      const mw = createSessionMiddleware(store, {
        runnerConfigSnapshot: { model: 'GLM-4.7', skillDirs: ['/test/skills'] },
      });
      const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      await mw.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const meta = await store.getMeta(state.id);
      expect(meta!.runnerConfig.model).toBe('GLM-4.7');
      expect(meta!.runnerConfig.skillDirs).toEqual(['/test/skills']);
    });

    it('should create session for state that includes user messages', async () => {
      let state = createAgentState({ name: 'test-agent', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello agent');
      await middleware.beforeRun!({
        state,
        runnerOptions: mockRunnerOptions,
      });

      expect(await store.existsAsync(state.id)).toBe(true);
      const meta = await store.getMeta(state.id);
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe(state.id);
    });

    it('should store agentName in SessionMeta', async () => {
      const state = createAgentState({ name: 'my-agent', instructions: 'test', tools: [] });
      await middleware.beforeRun!({ state, runnerOptions: mockRunnerOptions });
      const meta = await store.getMeta(state.id);
      expect(meta!.agentName).toBe('my-agent');
    });
  });

  // NOTE: afterStep describe block was removed.
  // session-middleware no longer writes SessionEntry to session.jsonl on each step;
  // state.json (full AgentState snapshot) is saved once in afterRun.

  describe('afterRun', () => {
    it('should save state and update meta', async () => {
      const state = addUserMessage(
        createAgentState({ name: 'test', instructions: 'test', tools: [] }),
        'Hello'
      );
      await store.createWithId(state.id, 'test');
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
});
