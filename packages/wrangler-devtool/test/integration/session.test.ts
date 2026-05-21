import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkSession } from '../../src/tools/session-fork.js';
import { listSessions } from '../../src/tools/session-list.js';
import { SessionStore } from '@agentskillmania/wrangler';

describe('US5 & US6: Session management', () => {
  it('AC6.1-AC6.4: list sessions for workspace', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'devtool-intg-'));
    const baseDir = join(tempDir, 'sessions');

    // Create a session manually
    const store = new SessionStore(baseDir, tempDir);
    const sessionId = await store.createWithId('test-session-123', 'glm-5');

    const sessions = await listSessions(tempDir, baseDir);

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

    // Write some mock user-chat.jsonl
    await writeFile(
      join(store.getSessionDir(originalId), 'user-chat.jsonl'),
      '{"role":"user","content":"msg1"}\n{"role":"assistant","content":"reply1"}\n{"role":"user","content":"msg2"}\n',
      'utf-8'
    );

    // Fork from msg 2
    const newId = await forkSession(originalId, {
      msg: 2,
      workspace: tempDir,
      sessionBaseDir: baseDir,
    });

    expect(newId).not.toBe(originalId);

    // Verify original is untouched
    const originalDir = store.getSessionDir(originalId);
    const originalChat = await (
      await import('node:fs/promises')
    ).readFile(join(originalDir, 'user-chat.jsonl'), 'utf-8');
    expect(originalChat.trim().split('\n').length).toBe(3);

    // Verify new session exists
    const newStore = new SessionStore(baseDir, tempDir);
    const newDir = newStore.getSessionDir(newId);
    const newMeta = await newStore.getMeta(newId);
    expect(newMeta).toHaveProperty('id', newId);
    expect(newMeta).toHaveProperty('model', 'glm-5');
    expect(newMeta).toHaveProperty('workspacePath', tempDir);
    expect(newMeta).toHaveProperty('messageCount', 2);
  });
});
