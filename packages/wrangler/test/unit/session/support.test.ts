/**
 * @fileoverview Session support unit tests
 *
 * Tests createSessionSupport factory output: middleware, store, tools.
 * Also tests middleware behavioral contracts via direct hook invocation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSessionSupport } from '../../../src/session/support.js';
import { SessionStore } from '../../../src/session/session-store.js';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('createSessionSupport', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-support-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should return middlewares and store (no tools — moved to builtin)', () => {
    // calculate and ask_human were moved from session support to createBuiltinTools.
    // createSessionSupport now returns only { middlewares, store }.
    const result = createSessionSupport({
      workspacePath: '/test',
      sessionBaseDir: testBaseDir,
    });

    expect(result.middlewares).toHaveLength(2);
    expect(result.middlewares[0].name).toBe('session');
    expect(result.middlewares[1].name).toBe('session-naming');
    expect(result.store).toBeInstanceOf(SessionStore);
    expect(result.store.exists('never-created')).toBe(false);
    // No tools property — tools are now registered via createBuiltinTools
    expect((result as { tools?: unknown }).tools).toBeUndefined();
  });

  it('should create session files when store is used directly', async () => {
    const session = createSessionSupport({
      workspacePath: '/test/workspace',
      sessionBaseDir: testBaseDir,
    });

    await session.store.createWithId('test-session-1', 'test-model', 'test-agent');

    const entries = await readdir(testBaseDir, { recursive: true });
    const sessionEntries = (entries as string[]).filter((e) => (e as string).includes('meta.yaml'));
    expect(sessionEntries).toHaveLength(1);
  });

  // ── Middleware behavioral contract tests ────────────────────────────────

  describe('middlewares', () => {
    it('should have correct name', () => {
      const result = createSessionSupport({
        workspacePath: '/test',
        sessionBaseDir: testBaseDir,
      });
      expect(result.middlewares[0].name).toBe('session');
    });

    it('should create session in beforeRun when session does not exist', async () => {
      const result = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const sessionId = 'middleware-test-session';
      const mockState = {
        id: sessionId,
        config: { name: 'test-agent' },
        context: { messages: [] },
      };

      await result.middlewares[0].beforeRun!({
        state: mockState as any,
        runnerOptions: { model: 'gpt-4' },
      });

      const exists = await result.store.existsAsync(sessionId);
      expect(exists).toBe(true);
    });

    it('should not crash when beforeRun is called with empty messages', async () => {
      const result = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const mockState = {
        id: 'empty-msg-session',
        config: { name: 'test-agent' },
        context: { messages: [] },
      };

      // Should resolve without error — no user message to record
      await expect(
        result.middlewares[0].beforeRun!({
          state: mockState as any,
          runnerOptions: { model: 'gpt-4' },
        })
      ).resolves.toBeUndefined();
    });

    it('should return undefined from beforeRun (no stop signal)', async () => {
      const result = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const mockState = {
        id: 'passthrough-session',
        config: { name: 'test-agent' },
        context: { messages: [] },
      };

      const hookResult = await result.middlewares[0].beforeRun!({
        state: mockState as any,
        runnerOptions: { model: 'gpt-4' },
      });

      // Middleware should not return stop — it's passthrough
      expect(hookResult).toBeUndefined();
    });
  });
});
