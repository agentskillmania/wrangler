import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '../../../src/session/session-store.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { TranscriptEntry } from '../../../src/types.js';
import type { ConversationMessage } from '../../../src/session/types.js';

describe('SessionStore', () => {
  let store: SessionStore;
  let testBaseDir: string;
  const workspacePath = '/test/workspace';

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-test-store-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
    store = new SessionStore(testBaseDir, workspacePath);
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  describe('exists / existsAsync', () => {
    it('should return false for non-existent session', () => {
      expect(store.exists('nonexistent-id')).toBe(false);
    });

    it('should return true after createWithId', async () => {
      const sessionId = await store.createWithId('1745800000-test', 'GLM-4.7');
      expect(store.exists(sessionId)).toBe(true);
    });
  });

  describe('createWithId', () => {
    it('should create session directory with meta.yaml', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');
      const dirPath = store.getSessionDir(sessionId);
      const dirStat = await stat(dirPath);
      expect(dirStat.isDirectory()).toBe(true);

      const files = await readdir(dirPath);
      expect(files).toContain('meta.yaml');
    });

    it('should write correct metadata', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');
      const meta = await store.getMeta(sessionId);
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe(sessionId);
      expect(meta!.workspacePath).toBe(workspacePath);
      expect(meta!.model).toBe('GLM-4.7');
      expect(meta!.messageCount).toBe(0);
    });
  });

  describe('saveState / loadState', () => {
    it('should save and restore AgentState via snapshot', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      const state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a test agent.',
        tools: [],
      });
      const stateWithMsg = addUserMessage(state, 'Hello');

      await store.saveState(sessionId, stateWithMsg);
      const loaded = await store.loadState(sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(stateWithMsg.id);
      expect(loaded!.context.messages).toHaveLength(1);
      expect(loaded!.context.messages[0].content).toBe('Hello');
    });

    it('should return null for non-existent session', async () => {
      const loaded = await store.loadState('nonexistent-id');
      expect(loaded).toBeNull();
    });

    it('should use Snapshot format with checksum', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');
      const state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a test agent.',
        tools: [],
      });
      await store.saveState(sessionId, state);

      const dirPath = store.getSessionDir(sessionId);
      const raw = await readFile(join(dirPath, 'state.json'), 'utf-8');
      const payload = JSON.parse(raw);
      expect(payload.version).toBe('1.0.0');
      expect(payload.checksum).toBeDefined();
      expect(payload.state).toBeDefined();
    });
  });

  describe('appendTranscript', () => {
    it('should append transcript entry to file', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      const entry: TranscriptEntry = {
        type: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };
      await store.appendTranscript(sessionId, entry);

      const dirPath = store.getSessionDir(sessionId);
      const content = await readFile(join(dirPath, 'transcript.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.type).toBe('user');
      expect(parsed.content).toBe('Hello');
    });

    it('should append multiple entries in order', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      await store.appendTranscript(sessionId, {
        type: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });
      await store.appendTranscript(sessionId, {
        type: 'assistant',
        content: 'Hi there!',
        timestamp: Date.now(),
      });

      const dirPath = store.getSessionDir(sessionId);
      const content = await readFile(join(dirPath, 'transcript.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).type).toBe('user');
      expect(JSON.parse(lines[1]).type).toBe('assistant');
    });
  });

  describe('updateMeta', () => {
    it('should update metadata fields', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');
      await store.updateMeta(sessionId, { messageCount: 5, updatedAt: '2026-04-28T15:00:00.000Z' });

      const meta = await store.getMeta(sessionId);
      expect(meta).not.toBeNull();
      expect(meta!.messageCount).toBe(5);
      expect(meta!.updatedAt).toBe('2026-04-28T15:00:00.000Z');
      expect(meta!.id).toBe(sessionId);
    });

    it('should do nothing when meta does not exist', async () => {
      // Create session dir without meta.yaml
      const sessionId = '1745800000-nometa';
      const dir = store.getSessionDir(sessionId);
      await mkdir(dir, { recursive: true });

      // Should not throw
      await store.updateMeta(sessionId, { messageCount: 5 });
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const sessions = await store.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should list sessions for the workspace', async () => {
      await store.createWithId('1745800001-test1', 'GLM-4.7');
      await store.createWithId('1745800002-test2', 'GLM-4.7');

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should not list sessions from different workspace', async () => {
      await store.createWithId('1745800001-test1', 'GLM-4.7');

      const otherStore = new SessionStore(testBaseDir, '/other/workspace');
      const sessions = await otherStore.listSessions();
      expect(sessions).toHaveLength(0);
    });

    it('should skip non-directory entries in workspace dir', async () => {
      await store.createWithId('1745800001-test1', 'GLM-4.7');
      // Create a file in the workspace dir (not a directory)
      const { writeFile } = await import('node:fs/promises');
      const wsDir = store.getSessionDir('').replace(/\/$/, '');
      const parentDir = wsDir.substring(0, wsDir.lastIndexOf('/'));
      await writeFile(join(parentDir, 'rogue-file.txt'), 'not a session', 'utf-8');

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(1);
    });

    it('should skip sessions with missing or corrupt meta', async () => {
      await store.createWithId('1745800001-test1', 'GLM-4.7');
      // Create a directory without meta.yaml
      const { mkdir: mkdirFn, writeFile: writeFileFn } = await import('node:fs/promises');
      const wsDir = store.getSessionDir('').replace(/\/$/, '');
      const parentDir = wsDir.substring(0, wsDir.lastIndexOf('/'));
      await mkdirFn(join(parentDir, 'empty-session-dir'), { recursive: true });

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe('deleteSession', () => {
    it('should remove session directory', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');
      expect(store.exists(sessionId)).toBe(true);

      await store.deleteSession(sessionId);
      expect(store.exists(sessionId)).toBe(false);
    });
  });

  describe('appendMessage / readConversation', () => {
    it('should append a ConversationMessage to user-chat.jsonl', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      const msg: ConversationMessage = {
        role: 'user',
        content: 'Hello agent',
        timestamp: Date.now(),
      };
      await store.appendMessage(sessionId, msg);

      const dirPath = store.getSessionDir(sessionId);
      const content = await readFile(join(dirPath, 'user-chat.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.role).toBe('user');
      expect(parsed.content).toBe('Hello agent');
      expect(parsed.timestamp).toBe(msg.timestamp);
    });

    it('should read all ConversationMessages in order', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      await store.appendMessage(sessionId, {
        role: 'user',
        content: 'Hello',
        timestamp: 1000,
      });
      await store.appendMessage(sessionId, {
        role: 'assistant',
        content: 'Hi!',
        timestamp: 2000,
      });
      await store.appendMessage(sessionId, {
        role: 'tool',
        content: 'result output',
        timestamp: 3000,
        toolName: 'read',
      });

      const messages = await store.readConversation(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].role).toBe('tool');
      expect(messages[2].toolName).toBe('read');
    });

    it('should write one JSON per line (JSONL format)', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      await store.appendMessage(sessionId, { role: 'user', content: 'a', timestamp: 1 });
      await store.appendMessage(sessionId, { role: 'user', content: 'b', timestamp: 2 });

      const dirPath = store.getSessionDir(sessionId);
      const raw = await readFile(join(dirPath, 'user-chat.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(2);
      // Each line is valid JSON
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('should return empty array for non-existent session', async () => {
      const messages = await store.readConversation('nonexistent-id');
      expect(messages).toEqual([]);
    });

    it('should handle messages with optional fields', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      const errorMsg: ConversationMessage = {
        role: 'error',
        content: 'something went wrong',
        timestamp: Date.now(),
        errorMessage: 'ENOENT: file not found',
      };
      await store.appendMessage(sessionId, errorMsg);

      const messages = await store.readConversation(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].errorMessage).toBe('ENOENT: file not found');
    });

    it('should handle messages with exitCode and toolArguments', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'GLM-4.7');

      const toolMsg: ConversationMessage = {
        role: 'tool',
        content: 'command output',
        timestamp: Date.now(),
        toolName: 'shell',
        toolArguments: '{"command":"ls -la"}',
        exitCode: 0,
      };
      await store.appendMessage(sessionId, toolMsg);

      const messages = await store.readConversation(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].toolName).toBe('shell');
      expect(messages[0].toolArguments).toBe('{"command":"ls -la"}');
      expect(messages[0].exitCode).toBe(0);
    });
  });
});
