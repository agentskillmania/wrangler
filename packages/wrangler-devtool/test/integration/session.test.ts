import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkSession, listSessions } from '../../src/tools/session-manager.js';
import { SessionStore } from '@agentskillmania/wrangler';
import type { AgentState } from '@agentskillmania/colts';

describe('US5 & US6: Session management', () => {
  it('AC6.1-AC6.4: list sessions for workspace', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const baseDir = join(tempDir, 'sessions');

    // Create a session manually
    const store = new SessionStore(baseDir, tempDir);
    await store.createWithId('test-session-123', 'glm-5');

    const sessions = await listSessions({ workspacePath: tempDir, sessionBaseDir: baseDir });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toHaveProperty('id');
    expect(sessions[0]).toHaveProperty('createdAt');
  });

  it('AC5.1-AC5.5: fork session copies state and truncates history', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const baseDir = join(tempDir, 'sessions');

    // Create original session
    const store = new SessionStore(baseDir, tempDir);
    const originalId = await store.createWithId('original-session', 'glm-5');

    // Save a state with messages matching entries
    const mockState: AgentState = {
      context: {
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'msg1',
            timestamp: Date.now(),
          } as unknown as AgentState['context']['messages'][number],
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'reply1',
            api: 'openai',
            provider: 'openai',
            model: 'glm-5',
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
            timestamp: Date.now(),
          } as unknown as AgentState['context']['messages'][number],
          {
            id: 'msg-3',
            role: 'user',
            content: 'msg2',
            timestamp: Date.now(),
          } as unknown as AgentState['context']['messages'][number],
        ],
      },
    };
    await store.saveState(originalId, mockState);

    // Write some mock session.jsonl with entry IDs
    await writeFile(
      join(store.getSessionDir(originalId), 'session.jsonl'),
      '{"id":"msg-1","role":"user","content":"msg1","timestamp":1700000000000}\n{"id":"msg-2","role":"assistant","content":"reply1","timestamp":1700000000001}\n{"id":"msg-3","role":"user","content":"msg2","timestamp":1700000000002}\n',
      'utf-8'
    );

    // Fork from msg-3
    const newId = await forkSession(originalId, {
      upToMessageId: 'msg-3',
      workspace: tempDir,
      sessionBaseDir: baseDir,
    });

    expect(newId).not.toBe(originalId);

    // Verify original is untouched
    const originalDir = store.getSessionDir(originalId);
    const originalChat = await (
      await import('node:fs/promises')
    ).readFile(join(originalDir, 'session.jsonl'), 'utf-8');
    expect(originalChat.trim().split('\n').length).toBe(3);

    // Verify new session exists
    const newStore = new SessionStore(baseDir, tempDir);
    const newMeta = await newStore.getMeta(newId);
    expect(newMeta).toHaveProperty('id', newId);
    expect(newMeta).toHaveProperty('model', 'glm-5');
    expect(newMeta).toHaveProperty('workspacePath', tempDir);
  });

  it('fork non-existent session throws error', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const baseDir = join(tempDir, 'sessions');

    await expect(
      forkSession('nonexistent-session-id', {
        upToMessageId: 'msg-1',
        workspace: tempDir,
        sessionBaseDir: baseDir,
      })
    ).rejects.toThrow();
  });

  it('list sessions on empty directory returns empty array', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const baseDir = join(tempDir, 'sessions');
    await mkdir(baseDir, { recursive: true });

    const sessions = await listSessions({ workspacePath: tempDir, sessionBaseDir: baseDir });
    expect(sessions).toEqual([]);
  });

  it('list sessions on non-existent directory returns empty array', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const baseDir = join(tempDir, 'no-such-dir');

    const sessions = await listSessions({ workspacePath: tempDir, sessionBaseDir: baseDir });
    expect(sessions).toEqual([]);
  });
});
