/**
 * US2: SessionStore conversation 模型
 *
 * 作为开发者，SessionStore 使用统一的 jsonl conversation 格式记录 agent 交互，
 * 取代旧的 transcript 格式。session-middleware 重构为使用 ConversationMessage。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionSupport } from '../../src/session/support.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { ConversationMessage } from '../../src/session/types.js';
import { testConfig, itif } from './config.js';

function makeRunner(tools: any[], middleware: any[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llm: { apiKey: testConfig.apiKey, provider: testConfig.provider, baseUrl: testConfig.baseUrl },
    tools,
    middleware,
  });
}

describe('US2: SessionStore conversation 模型', () => {
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

  describe('appendMessage / readConversation', () => {
    it('writes and reads ConversationMessage in jsonl format', async () => {
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });

      const sessionId = '1745800000-conv-test';
      await session.store.createWithId(sessionId, 'test-model');

      const msg1: ConversationMessage = {
        role: 'user',
        content: 'Hello agent',
        timestamp: 1000,
      };
      const msg2: ConversationMessage = {
        role: 'assistant',
        content: 'Hi! How can I help?',
        timestamp: 2000,
      };
      const msg3: ConversationMessage = {
        role: 'tool',
        content: 'file contents...',
        timestamp: 3000,
        toolName: 'file_read',
        toolArguments: '{"path":"src/app.ts"}',
      };

      await session.store.appendMessage(sessionId, msg1);
      await session.store.appendMessage(sessionId, msg2);
      await session.store.appendMessage(sessionId, msg3);

      // Verify via API
      const messages = await session.store.readConversation(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0]).toEqual(msg1);
      expect(messages[1]).toEqual(msg2);
      expect(messages[2]).toEqual(msg3);

      // Verify raw jsonl format — one JSON per line
      const dir = session.store.getSessionDir(sessionId);
      const raw = await readFile(join(dir, 'user-chat.jsonl'), 'utf-8');
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

      const messages = await session.store.readConversation('nonexistent');
      expect(messages).toEqual([]);
    });
  });

  itif(testConfig.enabled)(
    'session-middleware writes ConversationMessage to user-chat.jsonl on agent run',
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
      const messages = await session.store.readConversation(sessionId);

      // Should have at least an assistant message from the run
      expect(messages.length).toBeGreaterThanOrEqual(1);

      // Verify ConversationMessage shape
      const assistantMsgs = messages.filter((m) => m.role === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThan(0);
      expect(assistantMsgs[0].content).toBeTruthy();
      expect(assistantMsgs[0].timestamp).toBeGreaterThan(0);

      // Verify the file is user-chat.jsonl, not transcript.jsonl
      const dir = session.store.getSessionDir(sessionId);
      const raw = await readFile(join(dir, 'user-chat.jsonl'), 'utf-8');
      expect(raw.length).toBeGreaterThan(0);
    },
    60000
  );
});
