import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { produce } from 'immer';
import { randomUUID } from 'node:crypto';
import { sessionCommand } from '../../../../src/cli/commands/session.js';
import { ExitCode } from '../../../../src/cli/options.js';

describe('session command', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let sessionBaseDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `session-cmd-test-${Date.now()}`);
    sessionBaseDir = join(tempDir, 'sessions');
    await mkdir(sessionBaseDir, { recursive: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  async function createSession(
    workspacePath: string,
    sessionId: string,
    opts?: { withState?: boolean; entries?: { id: string; role: string; content: string }[] }
  ): Promise<void> {
    const store = new SessionStore(sessionBaseDir, workspacePath);
    await store.createWithId(sessionId, 'gpt-4', 'test-agent');

    if (opts?.withState) {
      let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
      state = addUserMessage(state, 'Hello');
      state = produce(state, (draft) => {
        draft.context.messages[0].id = randomUUID();
      });
      await store.saveState(sessionId, state);
    }

    if (opts?.entries) {
      for (const entry of opts.entries) {
        await store.appendEntry(sessionId, {
          ...entry,
          timestamp: Date.now(),
        } as import('@agentskillmania/wrangler').SessionEntry);
      }
    }
  }

  it('should list sessions', async () => {
    const wsPath = join(tempDir, 'workspace');
    await createSession(wsPath, 's1', { withState: true });

    const originalEnv = process.env.WRANGLER_DEVTOOL_SESSION_DIR;
    process.env.WRANGLER_DEVTOOL_SESSION_DIR = sessionBaseDir;

    try {
      const listCmd = sessionCommand.subcommands!.list;
      const code = await listCmd.handler!([wsPath], {});
      expect(code).toBe(ExitCode.Success);
      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(output.sessions).toHaveLength(1);
      expect(output.sessions[0].id).toBe('s1');
    } finally {
      if (originalEnv !== undefined) {
        process.env.WRANGLER_DEVTOOL_SESSION_DIR = originalEnv;
      } else {
        delete process.env.WRANGLER_DEVTOOL_SESSION_DIR;
      }
    }
  });

  it('should list sessions without workspace path', async () => {
    const wsPath = process.cwd();
    await createSession(wsPath, 's2', { withState: true });

    const originalEnv = process.env.WRANGLER_DEVTOOL_SESSION_DIR;
    process.env.WRANGLER_DEVTOOL_SESSION_DIR = sessionBaseDir;

    try {
      const listCmd = sessionCommand.subcommands!.list;
      const code = await listCmd.handler!([], {});
      expect(code).toBe(ExitCode.Success);
    } finally {
      if (originalEnv !== undefined) {
        process.env.WRANGLER_DEVTOOL_SESSION_DIR = originalEnv;
      } else {
        delete process.env.WRANGLER_DEVTOOL_SESSION_DIR;
      }
    }
  });

  it('should reject missing session id directly', async () => {
    const forkCmd = sessionCommand.subcommands!.fork;
    await expect(forkCmd.handler!([], { before: 'msg-1' })).rejects.toThrow();
  });

  it('should fork a session via handler', async () => {
    const wsPath = join(tempDir, 'workspace');
    const entryId = randomUUID();
    await createSession(wsPath, 'source', {
      withState: true,
      entries: [
        { id: entryId, role: 'user', content: 'Hello' },
        { id: randomUUID(), role: 'assistant', content: 'Hi' },
      ],
    });

    const originalEnv = process.env.WRANGLER_DEVTOOL_SESSION_DIR;
    process.env.WRANGLER_DEVTOOL_SESSION_DIR = sessionBaseDir;

    try {
      const forkCmd = sessionCommand.subcommands!.fork;
      const code = await forkCmd.handler!(['source'], { before: entryId });
      expect(code).toBe(ExitCode.Success);

      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(typeof output.newSessionId).toBe('string');
      expect(output.newSessionId).not.toBe('source');
    } finally {
      if (originalEnv !== undefined) {
        process.env.WRANGLER_DEVTOOL_SESSION_DIR = originalEnv;
      } else {
        delete process.env.WRANGLER_DEVTOOL_SESSION_DIR;
      }
    }
  });
});
