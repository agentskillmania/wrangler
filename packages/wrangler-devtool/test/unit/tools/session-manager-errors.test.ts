import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  resume: vi.fn(),
  listSessions: vi.fn(),
  createWithId: vi.fn(),
  updateMeta: vi.fn(),
  saveState: vi.fn(),
  appendEntry: vi.fn(),
  getMeta: vi.fn(),
  readMeta: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', () => ({
  SessionStore: vi.fn().mockImplementation(() => ({
    resume: mocks.resume,
    listSessions: mocks.listSessions,
    createWithId: mocks.createWithId,
    updateMeta: mocks.updateMeta,
    saveState: mocks.saveState,
    appendEntry: mocks.appendEntry,
    getMeta: mocks.getMeta,
  })),
  readMeta: mocks.readMeta,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readdir: mocks.readdir,
  };
});

import { forkSession, listSessions } from '../../../src/tools/session-manager.js';

function fakeDir(name: string) {
  return { name, isDirectory: () => true } as unknown as Awaited<
    ReturnType<typeof mocks.readdir>
  >[number];
}

describe('session-manager error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resume.mockReset();
    mocks.readMeta.mockReset();
    mocks.readdir.mockReset();
  });

  it('throws when resume returns null', async () => {
    const baseDir = join(tmpdir(), 'resume-fail');
    const workspacePath = '/tmp/ws';
    const sessionId = 'source-session';

    mocks.readdir.mockResolvedValue([fakeDir('ws')]);
    mocks.readMeta.mockResolvedValue({
      id: sessionId,
      workspacePath,
      agentName: 'test-agent',
      createdAt: new Date().toISOString(),
    });
    mocks.resume.mockResolvedValue(null);

    await expect(
      forkSession(sessionId, { upToMessageId: 'msg-1', sessionBaseDir: baseDir })
    ).rejects.toThrow('Failed to resume session');

    expect(mocks.resume).toHaveBeenCalledWith(sessionId);
  });

  it('returns empty array when allWorkspaces readdir throws', async () => {
    const baseDir = join(tmpdir(), 'readdir-fail');
    mocks.readdir.mockRejectedValue(new Error('ENOTDIR'));

    const sessions = await listSessions({ sessionBaseDir: baseDir, allWorkspaces: true });

    expect(sessions).toEqual([]);
    expect(mocks.readdir).toHaveBeenCalledWith(baseDir, { withFileTypes: true });
  });

  it('returns empty workspace list when workspace readdir throws', async () => {
    const baseDir = join(tmpdir(), 'ws-readdir-fail');

    mocks.readdir.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p === baseDir) {
        return [fakeDir('ws-a')] as never;
      }
      throw new Error('EACCES');
    });

    const sessions = await listSessions({ sessionBaseDir: baseDir, allWorkspaces: true });

    expect(sessions).toEqual([]);
  });
});
