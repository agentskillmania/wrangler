/**
 * @fileoverview Unit tests for the python TOOL layer (python.ts).
 *
 * Source file under test: src/tools/builtin/python.ts (createPythonTool).
 * Layer: UNIT — deps.execArray is mocked, no real python, no real filesystem.
 *
 * Verifies the TOOL-LAYER contract: argument handling (code vs file mode),
 * routing through execArray (not exec), error formatting. The actual python
 * execution is tested end-to-end in integration/python-tool.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPythonTool } from '../../../../src/tools/builtin/python.js';
import type { ExecResult, ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

const WORKSPACE = '/workspace';

function makeMockDeps(
  opts: {
    execArrayResult?: ExecResult;
    execArrayThrow?: Error;
  } = {}
): ToolDeps & {
  execArray: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
} {
  const execArrayFn = vi.fn(async () => {
    if (opts.execArrayThrow) throw opts.execArrayThrow;
    return opts.execArrayResult ?? { stdout: '', stderr: '', exitCode: 0 };
  });
  const execFn = vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 }));
  return {
    workspaceRoot: WORKSPACE,
    maxOutputSize: 1024,
    resolvePath: (p: string) => `${WORKSPACE}/${p}`,
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

describe('createPythonTool (unit, mocked deps)', () => {
  it('errors when neither code nor file is provided', async () => {
    const deps = makeMockDeps();
    const tool = createPythonTool(deps);
    const result = await tool.execute({});
    expect(result).toContain('Provide either');
    expect(deps.execArray).not.toHaveBeenCalled();
  });

  it('routes through execArray (not exec) for code mode', async () => {
    const deps = makeMockDeps();
    const tool = createPythonTool(deps);
    await tool.execute({ code: 'print(42)' });
    expect(deps.execArray).toHaveBeenCalledTimes(1);
    expect(deps.exec).not.toHaveBeenCalled();
  });

  it('routes through execArray (not exec) for file mode', async () => {
    const deps = makeMockDeps();
    const tool = createPythonTool(deps);
    await tool.execute({ file: 'script.py' });
    expect(deps.execArray).toHaveBeenCalledTimes(1);
    expect(deps.exec).not.toHaveBeenCalled();
  });

  // ─── code mode: argv contract ──────────────────────────────

  it('passes code as a single argv element via -c flag', async () => {
    const deps = makeMockDeps();
    const tool = createPythonTool(deps);
    await tool.execute({ code: 'print("hello world")' });
    // code is one literal argv element — no shell quoting needed
    expect(deps.execArray).toHaveBeenCalledWith('python3', ['-c', 'print("hello world")']);
  });

  it('passes code with single-quotes as a literal argv element (no escaping needed)', async () => {
    const deps = makeMockDeps();
    const tool = createPythonTool(deps);
    await tool.execute({ code: "print('it\\'s working')" });
    const [, args] = deps.execArray.mock.calls[0];
    // The entire code string is one argv element, quotes and all
    expect(args).toEqual(['-c', "print('it\\'s working')"]);
  });

  // ─── file mode: argv contract ──────────────────────────────

  it('passes resolved file path as a single argv element', async () => {
    const deps = makeMockDeps();
    const tool = createPythonTool(deps);
    await tool.execute({ file: 'script.py' });
    expect(deps.execArray).toHaveBeenCalledWith('python3', ['/workspace/script.py']);
  });

  // ─── output formatting ─────────────────────────────────────

  it('returns "(no output)" when stdout is empty on success', async () => {
    const deps = makeMockDeps({
      execArrayResult: { stdout: '', stderr: '', exitCode: 0 },
    });
    const tool = createPythonTool(deps);
    const result = await tool.execute({ code: 'pass' });
    expect(result).toBe('(no output)');
  });

  it('formats non-zero exit with stdout and stderr', async () => {
    const deps = makeMockDeps({
      execArrayResult: { stdout: 'partial', stderr: 'Traceback', exitCode: 1 },
    });
    const tool = createPythonTool(deps);
    const result = await tool.execute({ code: 'raise Exception()' });
    expect(result).toContain('Exit code: 1');
    expect(result).toContain('STDOUT');
    expect(result).toContain('STDERR');
    expect(result).toContain('Traceback');
  });

  it('propagates execArray errors', async () => {
    const deps = makeMockDeps({ execArrayThrow: new Error('python not found') });
    const tool = createPythonTool(deps);
    await expect(tool.execute({ code: 'print(1)' })).rejects.toThrow('python not found');
  });

  // ─── SEC4: command injection guards ────────────────────────
  // The file path is untrusted (LLM-supplied). It MUST be passed as a literal
  // argv element to execArray, never through a shell string. A filename
  // containing shell metacharacters (;, $(), spaces) must not trigger command
  // execution.

  describe('SEC4: file path is a literal argv element (no shell injection)', () => {
    it('treats a filename with spaces as one literal argument', async () => {
      const deps = makeMockDeps();
      const tool = createPythonTool(deps);
      await tool.execute({ file: 'my script.py' });
      expect(deps.exec).not.toHaveBeenCalled();
      const [, args] = deps.execArray.mock.calls[0];
      // 'my script.py' is one argv element, not split by shell
      expect(args).toEqual(['/workspace/my script.py']);
    });

    it('treats a filename with $() as a literal argument', async () => {
      const deps = makeMockDeps();
      const tool = createPythonTool(deps);
      await tool.execute({ file: 'x$(touch /workspace/PWNED)y.py' });
      expect(deps.exec).not.toHaveBeenCalled();
      const [, args] = deps.execArray.mock.calls[0];
      expect(args).toEqual(['/workspace/x$(touch /workspace/PWNED)y.py']);
    });

    it('treats a filename with semicolon as a literal argument', async () => {
      const deps = makeMockDeps();
      const tool = createPythonTool(deps);
      await tool.execute({ file: 'foo; rm -rf /workspace.py' });
      expect(deps.exec).not.toHaveBeenCalled();
      const [, args] = deps.execArray.mock.calls[0];
      expect(args).toEqual(['/workspace/foo; rm -rf /workspace.py']);
    });
  });
});
