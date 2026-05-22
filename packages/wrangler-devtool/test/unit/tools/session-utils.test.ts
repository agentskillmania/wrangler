import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SessionStore } from '@agentskillmania/wrangler';
import { createAgentState } from '@agentskillmania/colts';
import { findSessionGlobally, getDefaultSessionBaseDir } from '../../../src/tools/session-utils.js';

function hashWorkspacePath(workspacePath: string): string {
  return createHash('md5').update(resolve(workspacePath)).digest('hex');
}

describe('getDefaultSessionBaseDir', () => {
  it('returns path under home directory', () => {
    const dir = getDefaultSessionBaseDir();
    expect(dir).toContain('.agentskillmania');
    expect(dir).toContain('wrangler');
    expect(dir).toContain('sessions');
  });

  it('respects WRANGLER_DEVTOOL_SESSION_DIR env var', () => {
    const customDir = '/custom/sessions';
    process.env.WRANGLER_DEVTOOL_SESSION_DIR = customDir;
    try {
      expect(getDefaultSessionBaseDir()).toBe(customDir);
    } finally {
      delete process.env.WRANGLER_DEVTOOL_SESSION_DIR;
    }
  });
});

describe('findSessionGlobally', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = join(tmpdir(), `devtool-test-${Date.now()}`);
    await mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function createSession(workspacePath: string, sessionId: string): Promise<void> {
    const store = new SessionStore(baseDir, workspacePath);
    await store.createWithId(sessionId, 'gpt-4', 'test-agent');
    // Save a minimal state so resume() works
    const state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    await store.saveState(sessionId, state);
  }

  it('finds a session in a single workspace and returns correct store', async () => {
    const workspacePath = '/tmp/workspace-a';
    const sessionId = 'test-session-1';
    await createSession(workspacePath, sessionId);

    const result = await findSessionGlobally(sessionId, baseDir);

    expect(result).not.toBeNull();
    expect(result!.meta.id).toBe(sessionId);
    expect(result!.meta.workspacePath).toBe(workspacePath);

    // Verify the store can actually operate on the session
    const resumed = await result!.store.resume(sessionId);
    expect(resumed).not.toBeNull();
    expect(resumed!.meta.id).toBe(sessionId);
  });

  it('finds a session across multiple workspaces', async () => {
    const workspaceA = '/tmp/workspace-a';
    const workspaceB = '/tmp/workspace-b';
    const sessionId = 'cross-ws-session';

    await createSession(workspaceB, sessionId);
    await createSession(workspaceA, 'other-session');

    const result = await findSessionGlobally(sessionId, baseDir);

    expect(result).not.toBeNull();
    expect(result!.meta.workspacePath).toBe(workspaceB);
  });

  it('returns null when session is not found', async () => {
    await createSession('/tmp/ws', 'existing');

    const result = await findSessionGlobally('non-existent', baseDir);
    expect(result).toBeNull();
  });

  it('returns null when baseDir does not exist', async () => {
    const result = await findSessionGlobally('any', '/non/existent/path');
    expect(result).toBeNull();
  });

  it('returns null when baseDir exists but is empty', async () => {
    const result = await findSessionGlobally('any', baseDir);
    expect(result).toBeNull();
  });
});
