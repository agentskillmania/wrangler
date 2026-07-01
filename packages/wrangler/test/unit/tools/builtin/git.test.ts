import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGitTool } from '../../../../src/tools/builtin/git.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExecResult, ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

/** Build a ToolDeps mock that records execArray / exec calls. */
function makeMockDeps(
  opts: {
    execArrayResult?: ExecResult;
    execResult?: ExecResult;
    execThrow?: Error;
    execArrayThrow?: Error;
  } = {}
): ToolDeps & {
  execArray: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
} {
  const tempDir = '/workspace';
  const execArrayFn = vi.fn(async () => {
    if (opts.execArrayThrow) throw opts.execArrayThrow;
    return opts.execArrayResult ?? { stdout: '', stderr: '', exitCode: 0 };
  });
  const execFn = vi.fn(async () => {
    if (opts.execThrow) throw opts.execThrow;
    return opts.execResult ?? { stdout: '', stderr: '', exitCode: 0 };
  });
  return {
    workspaceRoot: tempDir,
    maxOutputSize: 1024,
    resolvePath: (p: string) => join(tempDir, p),
    exec: execFn,
    execArray: execArrayFn,
    readFile: async () => '',
    writeFile: async () => {},
    editFile: async () => '',
    glob: async () => [],
    grep: async () => '',
    statFile: async () => ({ exists: true, isFile: true }),
    isBinaryFile: async () => false,
  } as unknown as ToolDeps & {
    execArray: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
  };
}

describe('createGitTool (unit, mocked deps)', () => {
  it('routes through execArray (not exec) so no shell interprets the command', async () => {
    const deps = makeMockDeps();
    const tool = createGitTool(deps);
    await tool.execute({ command: 'status' });
    expect(deps.execArray).toHaveBeenCalledTimes(1);
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it('splits a simple subcommand into ["status"] and runs git with it', async () => {
    const deps = makeMockDeps();
    const tool = createGitTool(deps);
    await tool.execute({ command: 'status' });
    expect(deps.execArray).toHaveBeenCalledWith('git', ['status']);
  });

  it('splits "log --oneline" into separate argv elements', async () => {
    const deps = makeMockDeps();
    const tool = createGitTool(deps);
    await tool.execute({ command: 'log --oneline' });
    expect(deps.execArray).toHaveBeenCalledWith('git', ['log', '--oneline']);
  });

  it('preserves quoted arguments as single argv elements', async () => {
    // commit -m "fix: update parser" → the message is one arg
    const deps = makeMockDeps();
    const tool = createGitTool(deps);
    await tool.execute({ command: 'commit -m "fix: update parser"' });
    expect(deps.execArray).toHaveBeenCalledWith('git', ['commit', '-m', 'fix: update parser']);
  });

  it('returns "(no output)" when execArray yields empty stdout on success', async () => {
    const deps = makeMockDeps({
      execArrayResult: { stdout: '', stderr: '', exitCode: 0 },
    });
    const tool = createGitTool(deps);
    const result = await tool.execute({ command: 'status' });
    expect(result).toBe('(no output)');
  });

  it('formats non-zero exit with stdout and stderr', async () => {
    const deps = makeMockDeps({
      execArrayResult: { stdout: 'out', stderr: 'err', exitCode: 1 },
    });
    const tool = createGitTool(deps);
    const result = await tool.execute({ command: 'push' });
    expect(result).toContain('Exit code: 1');
    expect(result).toContain('STDOUT');
    expect(result).toContain('STDERR');
  });

  it('propagates execArray errors', async () => {
    const deps = makeMockDeps({ execArrayThrow: new Error('exec failed') });
    const tool = createGitTool(deps);
    await expect(tool.execute({ command: 'status' })).rejects.toThrow('exec failed');
  });

  // ─── SEC3: command injection guards ────────────────────────
  // The git tool MUST run via execArray (no shell) with argv parsed by
  // shell-quote. Shell operators (;, &&, ||, $, ()) parsed by shell-quote are
  // REJECTED — a legitimate git subcommand never needs them. This blocks
  // command chaining / substitution attempts while preserving normal git usage.

  describe('SEC3: shell operators in command are rejected, exec never called', () => {
    it('rejects ";" operator and does not call exec or execArray', async () => {
      const deps = makeMockDeps();
      const tool = createGitTool(deps);
      const result = await tool.execute({ command: 'status; rm -rf /' });
      expect(result).toMatch(/shell operator ";"/);
      expect(deps.exec).not.toHaveBeenCalled();
      expect(deps.execArray).not.toHaveBeenCalled();
    });

    it('rejects "&&" operator', async () => {
      const deps = makeMockDeps();
      const tool = createGitTool(deps);
      const result = await tool.execute({ command: 'status && rm -rf /' });
      expect(result).toMatch(/shell operator "&&"/);
      expect(deps.execArray).not.toHaveBeenCalled();
    });

    it('rejects "$()" command substitution', async () => {
      const deps = makeMockDeps();
      const tool = createGitTool(deps);
      const result = await tool.execute({ command: 'log $(whoami)' });
      // $ is parsed as an operator token by shell-quote
      expect(result).toMatch(/shell operator/);
      expect(deps.execArray).not.toHaveBeenCalled();
    });

    it('rejects pipe operator', async () => {
      const deps = makeMockDeps();
      const tool = createGitTool(deps);
      const result = await tool.execute({ command: 'log | grep fix' });
      expect(result).toMatch(/shell operator "\|"/);
      expect(deps.execArray).not.toHaveBeenCalled();
    });

    it('backticks are treated as literal (shell-quote keeps them as string)', async () => {
      // shell-quote does NOT parse backticks into operators, so `whoami`
      // survives as a literal string token — passed to git as-is, no execution.
      const deps = makeMockDeps();
      const tool = createGitTool(deps);
      await tool.execute({ command: 'log `whoami`' });
      expect(deps.exec).not.toHaveBeenCalled();
      const [, args] = deps.execArray.mock.calls[0];
      expect(args).toEqual(['log', '`whoami`']);
    });
  });
});
