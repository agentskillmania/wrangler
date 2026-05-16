import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { sessionCommand } from '../../../../src/cli/commands/session.js';
import { ExitCode } from '../../../../src/cli/options.js';

describe('session command', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let sessionBaseDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
    sessionBaseDir = join(tempDir, 'sessions');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  function createSession(workspacePath: string, sessionId: string, meta: Record<string, unknown>) {
    const hash = createHash('md5').update(workspacePath).digest('hex');
    const dir = join(sessionBaseDir, hash, sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.yaml'), yaml.dump(meta), 'utf-8');
  }

  it('should list sessions', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession(wsPath, 's1', {
      id: 's1',
      workspacePath: wsPath,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      model: 'gpt-4',
      messageCount: 1,
    });

    const originalEnv = process.env.WRANGLER_DEVTOOL_SESSION_DIR;
    process.env.WRANGLER_DEVTOOL_SESSION_DIR = sessionBaseDir;

    try {
      const listCmd = sessionCommand.subcommands!.list;
      const code = await listCmd.handler!([wsPath], {});
      expect(code).toBe(ExitCode.Success);
      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(output.sessions).toHaveLength(1);
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
    const hash = createHash('md5').update(wsPath).digest('hex');
    const dir = join(sessionBaseDir, hash, 's2');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'meta.yaml'),
      yaml.dump({
        id: 's2',
        workspacePath: wsPath,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        model: 'gpt-4',
        messageCount: 1,
      }),
      'utf-8'
    );

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
    await expect(forkCmd.handler!([], { msg: 1 })).rejects.toThrow();
  });

  it('should fork a session via handler', async () => {
    const wsPath = join(tempDir, 'workspace');
    const hash = createHash('md5').update(wsPath).digest('hex');
    const dir = join(sessionBaseDir, hash, 'source');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'meta.yaml'),
      yaml.dump({
        id: 'source',
        workspacePath: wsPath,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        model: 'gpt-4',
        messageCount: 3,
      }),
      'utf-8'
    );
    writeFileSync(
      join(dir, 'user-chat.jsonl'),
      '{"role":"user","content":"a"}\n{"role":"user","content":"b"}\n{"role":"user","content":"c"}\n',
      'utf-8'
    );
    writeFileSync(join(dir, 'state.json'), '{}', 'utf-8');

    // Set env so forkSession uses our temp dir
    const originalEnv = process.env.WRANGLER_DEVTOOL_SESSION_DIR;
    process.env.WRANGLER_DEVTOOL_SESSION_DIR = sessionBaseDir;

    try {
      const forkCmd = sessionCommand.subcommands!.fork;
      const code = await forkCmd.handler!(['source'], { msg: 2 });
      expect(code).toBe(ExitCode.Success);

      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(output.newSessionId).toBeDefined();
    } finally {
      if (originalEnv !== undefined) {
        process.env.WRANGLER_DEVTOOL_SESSION_DIR = originalEnv;
      } else {
        delete process.env.WRANGLER_DEVTOOL_SESSION_DIR;
      }
    }
  });
});
