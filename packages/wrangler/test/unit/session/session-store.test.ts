import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '../../../src/session/session-store.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import type { SessionEntry } from '../../../src/session/types.js';

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
      const sessionId = await store.createWithId('1745800000-test', 'test-agent');
      expect(store.exists(sessionId)).toBe(true);
    });
  });

  describe('createWithId', () => {
    it('should create session directory with meta.yaml', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');
      const dirPath = store.getSessionDir(sessionId);
      const dirStat = await stat(dirPath);
      expect(dirStat.isDirectory()).toBe(true);

      const files = await readdir(dirPath);
      expect(files).toContain('meta.yaml');
    });

    it('should write correct metadata including agentName', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'my-agent');
      const meta = await store.getMeta(sessionId);
      expect(meta!.id).toBe(sessionId);
      expect(meta!.workspacePath).toBe(workspacePath);
      expect(meta!.runnerConfig).toEqual({ model: '' });
      expect(meta!.agentName).toBe('my-agent');
    });
  });

  describe('saveState / loadState', () => {
    it('should save and restore AgentState via snapshot', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');

      const state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a test agent.',
        tools: [],
      });
      const stateWithMsg = addUserMessage(state, 'Hello');

      await store.saveState(sessionId, stateWithMsg);
      const loaded = await store.loadState(sessionId);

      expect(loaded!.id).toBe(stateWithMsg.id);
      expect(loaded!.context.messages).toHaveLength(1);
      expect(loaded!.context.messages[0].content).toBe('Hello');
    });

    it('should return null for non-existent session', async () => {
      const loaded = await store.loadState('nonexistent-id');
      expect(loaded).toBeNull();
    });

    it('should survive concurrent saveState calls without corrupting state.json', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');

      const states = Array.from({ length: 10 }, (_, i) => {
        const state = createAgentState({ name: `agent-${i}`, instructions: `msg-${i}`, tools: [] });
        return addUserMessage(state, `message-${i}`);
      });

      // Fire all saves concurrently
      await Promise.all(states.map((s) => store.saveState(sessionId, s)));

      // Load back — must be valid JSON and one of the saved states
      const loaded = await store.loadState(sessionId);
      expect(loaded).not.toBeNull();
      const name = loaded!.config.name;
      const msg = loaded!.context.messages[0].content;
      expect(name).toMatch(/^agent-\d+$/);
      expect(msg).toBe(`message-${name.split('-')[1]}`);
    });

    it('should persist AgentState as plain JSON without snapshot wrapper', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');
      const state = createAgentState({
        name: 'test-agent',
        instructions: 'You are a test agent.',
        tools: [],
      });
      await store.saveState(sessionId, state);

      const dirPath = store.getSessionDir(sessionId);
      const raw = await readFile(join(dirPath, 'state.json'), 'utf-8');
      const payload = JSON.parse(raw);
      // Plain AgentState — verify actual content, not just shape
      expect(payload.config.name).toBe('test-agent');
      expect(payload.config.instructions).toBe('You are a test agent.');
      expect(payload.context.messages).toEqual([]);
      // Not wrapped in snapshot format
      expect(payload).not.toHaveProperty('version');
      expect(payload).not.toHaveProperty('checksum');
    });
  });

  describe('updateMeta', () => {
    it('should update metadata fields', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');
      await store.updateMeta(sessionId, { updatedAt: '2026-04-28T15:00:00.000Z' });

      const meta = await store.getMeta(sessionId);
      expect(meta!.updatedAt).toBe('2026-04-28T15:00:00.000Z');
      expect(meta!.id).toBe(sessionId);
    });

    it('should do nothing when meta does not exist', async () => {
      // Create session dir without meta.yaml
      const sessionId = '1745800000-nometa';
      const dir = store.getSessionDir(sessionId);
      await mkdir(dir, { recursive: true });

      // Should not throw
      await store.updateMeta(sessionId, { updatedAt: '2026-04-28T15:00:00.000Z' });
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const sessions = await store.listSessions();
      expect(sessions).toEqual([]);
    });

    it('should list sessions for the workspace', async () => {
      await store.createWithId('1745800001-test1', 'agent-1');
      await store.createWithId('1745800002-test2', 'agent-2');

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should not list sessions from different workspace', async () => {
      await store.createWithId('1745800001-test1', 'test-agent');

      const otherStore = new SessionStore(testBaseDir, '/other/workspace');
      const sessions = await otherStore.listSessions();
      expect(sessions).toHaveLength(0);
    });

    it('should skip non-directory entries in workspace dir', async () => {
      await store.createWithId('1745800001-test1', 'test-agent');
      // Create a file in the workspace dir (not a directory)
      const { writeFile } = await import('node:fs/promises');
      const wsDir = store.getSessionDir('').replace(/\/$/, '');
      const parentDir = wsDir.substring(0, wsDir.lastIndexOf('/'));
      await writeFile(join(parentDir, 'rogue-file.txt'), 'not a session', 'utf-8');

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(1);
    });

    it('should skip sessions with missing or corrupt meta', async () => {
      await store.createWithId('1745800001-test1', 'test-agent');
      // Create a directory without meta.yaml
      const { mkdir: mkdirFn } = await import('node:fs/promises');
      const wsDir = store.getSessionDir('').replace(/\/$/, '');
      const parentDir = wsDir.substring(0, wsDir.lastIndexOf('/'));
      await mkdirFn(join(parentDir, 'empty-session-dir'), { recursive: true });

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe('workspace path normalization', () => {
    it('relative and absolute paths to same workspace produce same session directory', async () => {
      const absPath = '/test/workspace';
      // Construct a relative path that resolves back to the same absolute path
      const relPath = relative(process.cwd(), absPath);

      const absStore = new SessionStore(testBaseDir, absPath);
      const relStore = new SessionStore(testBaseDir, relPath);

      const sessionId = '1745800000-norm';
      await absStore.createWithId(sessionId, 'GLM-4.7', 'test-agent');

      const sessions = await relStore.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(sessionId);
    });
  });

  describe('deleteSession', () => {
    it('should remove session directory', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');
      expect(store.exists(sessionId)).toBe(true);

      await store.deleteSession(sessionId);
      expect(store.exists(sessionId)).toBe(false);
    });
  });

  describe('appendEntry', () => {
    it('should append a SessionEntry to session.jsonl', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');

      const entry: SessionEntry = {
        id: randomUUID(),
        role: 'user',
        content: 'Hello agent',
        timestamp: Date.now(),
      };
      await store.appendEntry(sessionId, entry);

      const dirPath = store.getSessionDir(sessionId);
      const content = await readFile(join(dirPath, 'session.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.id).toBe(entry.id);
      expect(parsed.role).toBe('user');
      expect(parsed.content).toBe('Hello agent');
      expect(parsed.timestamp).toBe(entry.timestamp);
    });

    it('should append multiple entries in order', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');

      await store.appendEntry(sessionId, {
        id: randomUUID(),
        role: 'user',
        content: 'Hello',
        timestamp: 1000,
      });
      await store.appendEntry(sessionId, {
        id: randomUUID(),
        role: 'assistant',
        content: 'Hi!',
        timestamp: 2000,
      });
      await store.appendEntry(sessionId, {
        id: randomUUID(),
        role: 'tool',
        content: 'result output',
        timestamp: 3000,
        toolName: 'read',
      });

      const dirPath = store.getSessionDir(sessionId);
      const raw = await readFile(join(dirPath, 'session.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).role).toBe('user');
      expect(JSON.parse(lines[1]).role).toBe('assistant');
      expect(JSON.parse(lines[2]).role).toBe('tool');
    });

    it('should write one JSON per line (JSONL format)', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');

      await store.appendEntry(sessionId, {
        id: randomUUID(),
        role: 'user',
        content: 'a',
        timestamp: 1,
      });
      await store.appendEntry(sessionId, {
        id: randomUUID(),
        role: 'user',
        content: 'b',
        timestamp: 2,
      });

      const dirPath = store.getSessionDir(sessionId);
      const raw = await readFile(join(dirPath, 'session.jsonl'), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(2);
      // Each line is valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toBeInstanceOf(Object);
      }
    });

    it('should handle entries with optional fields', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');

      const errorEntry: SessionEntry = {
        id: randomUUID(),
        role: 'error',
        content: 'something went wrong',
        timestamp: Date.now(),
        errorMessage: 'ENOENT: file not found',
      };
      await store.appendEntry(sessionId, errorEntry);

      const entries = await store.readEntries(sessionId);
      expect(entries).toHaveLength(1);
      expect(entries[0].errorMessage).toBe('ENOENT: file not found');
    });

    it('should handle entries with exitCode and toolArguments', async () => {
      const sessionId = '1745800000-test';
      await store.createWithId(sessionId, 'test-agent');

      const toolEntry: SessionEntry = {
        id: randomUUID(),
        role: 'tool',
        content: 'command output',
        timestamp: Date.now(),
        toolName: 'shell',
        toolArguments: '{"command":"ls -la"}',
        exitCode: 0,
      };
      await store.appendEntry(sessionId, toolEntry);

      const entries = await store.readEntries(sessionId);
      expect(entries).toHaveLength(1);
      expect(entries[0].toolName).toBe('shell');
      expect(entries[0].toolArguments).toBe('{"command":"ls -la"}');
      expect(entries[0].exitCode).toBe(0);
    });
  });

  describe('readEntries', () => {
    const sessionId = '1745800000-read-test';

    it('reads SessionEntry objects from session.jsonl', async () => {
      await store.createWithId(sessionId, 'test-agent');
      const entry: SessionEntry = {
        id: randomUUID(),
        role: 'user',
        content: 'hello',
        timestamp: Date.now(),
      };
      await store.appendEntry(sessionId, entry);
      const entries = await store.readEntries(sessionId);
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(entry.id);
      expect(entries[0].role).toBe('user');
      expect(entries[0].content).toBe('hello');
    });

    it('returns empty array when session.jsonl does not exist', async () => {
      await store.createWithId(sessionId, 'test-agent');
      const entries = await store.readEntries(sessionId);
      expect(entries).toEqual([]);
    });

    it('returns empty array for non-existent session', async () => {
      const entries = await store.readEntries('nonexistent-id');
      expect(entries).toEqual([]);
    });
  });

  describe('resume', () => {
    it('returns meta for existing session', async () => {
      const sessionId = '1745800000-resume-meta';
      await store.createWithId(sessionId, 'test-agent');
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const result = await store.resume(sessionId);
      expect(result).not.toBeNull();
      expect(result!.meta.id).toBe(sessionId);
      expect(result!.meta.agentName).toBe('test-agent');
    });

    it('returns state for existing session', async () => {
      const sessionId = '1745800000-resume-state';
      await store.createWithId(sessionId, 'test-agent');
      const agentState = createAgentState({ name: 'test-agent', instructions: 'test', tools: [] });
      await store.saveState(sessionId, agentState);

      const result = await store.resume(sessionId);
      expect(result).not.toBeNull();
      expect(result!.state.id).toBe(agentState.id);
      expect(result!.state.config.name).toBe('test-agent');
    });

    it('returns recent entries for existing session', async () => {
      const sessionId = '1745800000-resume-entries';
      await store.createWithId(sessionId, 'test-agent');
      await store.appendEntry(sessionId, {
        id: randomUUID(),
        role: 'user',
        content: 'hello',
        timestamp: Date.now(),
      });
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);

      const result = await store.resume(sessionId);
      expect(result).not.toBeNull();
      expect(result!.recentEntries).toHaveLength(1);
      expect(result!.recentEntries[0].role).toBe('user');
      expect(result!.recentEntries[0].content).toBe('hello');
    });

    it('returns null for non-existent session', async () => {
      const result = await store.resume('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when state.json missing', async () => {
      const sessionId = '1745800000-resume-nostate';
      await store.createWithId(sessionId, 'test-agent');
      const result = await store.resume(sessionId);
      expect(result).toBeNull();
    });
  });

  describe('fromDir', () => {
    it('getMeta() does not require sessionId', async () => {
      const sessionId = '1745800000-fromdir-test';
      await store.createWithId(sessionId, 'test-agent');
      const dir = store.getSessionDir(sessionId);

      const boundStore = SessionStore.fromDir(dir);
      const meta = await boundStore.getMeta();
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe(sessionId);
      expect(meta!.agentName).toBe('test-agent');
    });

    it('loadState() does not require sessionId', async () => {
      const sessionId = '1745800000-fromdir-state';
      await store.createWithId(sessionId, 'test-agent');
      const agentState = createAgentState({ name: 'test-agent', tools: [] });
      await store.saveState(sessionId, agentState);
      const dir = store.getSessionDir(sessionId);

      const boundStore = SessionStore.fromDir(dir);
      const loaded = await boundStore.loadState();
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(agentState.id);
    });

    it('saveState() does not require sessionId', async () => {
      const sessionId = '1745800000-fromdir-save';
      await store.createWithId(sessionId, 'test-agent');
      const dir = store.getSessionDir(sessionId);

      const boundStore = SessionStore.fromDir(dir);
      const newState = createAgentState({ name: 'updated-agent', tools: [] });
      await boundStore.saveState(undefined, newState);

      const loaded = await boundStore.loadState();
      expect(loaded).not.toBeNull();
      expect(loaded!.config.name).toBe('updated-agent');
    });

    it('throws when sessionId is passed to a bound store', async () => {
      const sessionId = '1745800000-fromdir-bound';
      await store.createWithId(sessionId, 'test-agent');
      const dir = store.getSessionDir(sessionId);

      const boundStore = SessionStore.fromDir(dir);
      await expect(boundStore.getMeta(sessionId)).rejects.toThrow(
        'Directory-bound SessionStore does not accept sessionId'
      );
    });

    it('throws when sessionId is omitted for a workspace-based store', async () => {
      await expect(store.getMeta()).rejects.toThrow(
        'sessionId is required for workspace-based SessionStore'
      );
    });

    it('readEntries() does not require sessionId', async () => {
      const sessionId = '1745800000-fromdir-entries';
      await store.createWithId(sessionId, 'test-agent');
      const entry: SessionEntry = {
        id: randomUUID(),
        role: 'user',
        content: 'hello',
        timestamp: Date.now(),
      };
      await store.appendEntry(sessionId, entry);
      const dir = store.getSessionDir(sessionId);

      const boundStore = SessionStore.fromDir(dir);
      const entries = await boundStore.readEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('hello');
    });
  });

  describe('negative paths', () => {
    it('returns null when loading state from a non-existent session', async () => {
      const loaded = await store.loadState('no-such-session');
      expect(loaded).toBeNull();
    });

    it('returns null when loading state from corrupt JSON', async () => {
      const sessionId = '1745800000-corrupt-state';
      await store.createWithId(sessionId, 'test-agent');
      const dir = store.getSessionDir(sessionId);
      await writeFile(join(dir, 'state.json'), 'not-json', 'utf-8');

      const loaded = await store.loadState(sessionId);
      expect(loaded).toBeNull();
    });

    it('returns empty entries when session.jsonl contains invalid lines', async () => {
      const sessionId = '1745800000-bad-jsonl';
      await store.createWithId(sessionId, 'test-agent');
      const dir = store.getSessionDir(sessionId);
      await writeFile(join(dir, 'session.jsonl'), 'not-json\n{"role":"user"}\n', 'utf-8');

      const entries = await store.readEntries(sessionId);
      expect(entries).toEqual([]);
    });

    it('throws when workspace-based store is asked for sessionDir without sessionId', () => {
      expect(() => store.getSessionDir()).toThrow(
        'sessionId is required for workspace-based SessionStore'
      );
    });

    it('does not throw when deleting a non-existent session', async () => {
      await expect(store.deleteSession('no-such-session')).resolves.toBeUndefined();
    });
  });
});
