/**
 * US2: SessionStore conversation model
 *
 * SessionStore uses unified jsonl session format with SessionEntry,
 * replacing the old transcript format. session-middleware refactored
 * to use SessionEntry.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createSessionSupport } from '../../src/session/support.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { SessionEntry } from '../../src/session/types.js';
import { testConfig, itif } from './config.js';

function makeRunner(tools: unknown[], middleware: unknown[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llm: { apiKey: testConfig.apiKey, provider: testConfig.provider, baseUrl: testConfig.baseUrl },
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
    it('writes and reads SessionEntry in jsonl format', async () => {
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const sessionId = '1745800000-conv-test';
      await session.store.createWithId(sessionId, 'test-model', 'test-agent');

      const entry1: SessionEntry = {
        id: randomUUID(),
        role: 'user',
        content: 'Hello agent',
        timestamp: 1000,
      };
      const entry2: SessionEntry = {
        id: randomUUID(),
        role: 'assistant',
        content: 'Hi! How can I help?',
        timestamp: 2000,
      };
      const entry3: SessionEntry = {
        id: randomUUID(),
        role: 'tool',
        content: 'file contents...',
        timestamp: 3000,
        toolName: 'file_read',
        toolArguments: '{"path":"src/app.ts"}',
      };

      await session.store.appendEntry(sessionId, entry1);
      await session.store.appendEntry(sessionId, entry2);
      await session.store.appendEntry(sessionId, entry3);

      // Verify via API
      const entries = await session.store.readEntries(sessionId);
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual(entry1);
      expect(entries[1]).toEqual(entry2);
      expect(entries[2]).toEqual(entry3);

      // Verify raw jsonl format — one JSON per line
      const dir = session.store.getSessionDir(sessionId);
      const raw = await readFile(join(dir, 'session.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(3);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('returns empty array for non-existent session', async () => {
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const entries = await session.store.readEntries('nonexistent');
      expect(entries).toEqual([]);
    });
  });

  itif(testConfig.enabled)(
    'session-middleware writes SessionEntry to session.jsonl on agent run',
    async () => {
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const runner = makeRunner(session.tools, [session.middleware]);

      let state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a helpful assistant. Answer in one short sentence.',
        tools: [],
      });
      state = addUserMessage(state, 'What is the capital of France?');

      await runner.run(state);

      const sessionId = state.id;
      const entries = await session.store.readEntries(sessionId);

      // Should have at least a user message and an assistant entry from the run
      expect(entries.length).toBeGreaterThanOrEqual(2);

      // Verify SessionEntry shape
      const assistantEntries = entries.filter((e) => e.role === 'assistant');
      expect(assistantEntries.length).toBeGreaterThan(0);
      expect(assistantEntries[0].content).toBeTruthy();
      expect(assistantEntries[0].timestamp).toBeGreaterThan(0);
      expect(assistantEntries[0].id).toBeDefined();

      // Verify the file is session.jsonl
      const dir = session.store.getSessionDir(sessionId);
      const raw = await readFile(join(dir, 'session.jsonl'), 'utf-8');
      expect(raw.length).toBeGreaterThan(0);
    },
    60000
  );
});
