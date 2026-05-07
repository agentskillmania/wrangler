import { describe, it, expect, vi } from 'vitest';
import { createShellTool } from '../../../../src/tools/builtin/shell.js';
import type { Sandbox } from '@agentskillmania/sandbox';

function createMockSandbox(runResult?: { stdout: string; stderr: string; exitCode: number }) {
  return {
    run: vi.fn().mockResolvedValue(runResult ?? { stdout: 'hello world', stderr: '', exitCode: 0 }),
  } as unknown as Sandbox;
}

describe('shell tool', () => {
  it('has correct tool metadata', () => {
    const tool = createShellTool(createMockSandbox());
    expect(tool.name).toBe('shell');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });

  it('returns stdout on success', async () => {
    const sandbox = createMockSandbox({ stdout: 'file1.txt\nfile2.txt', stderr: '', exitCode: 0 });
    const tool = createShellTool(sandbox);

    const result = await tool.execute({ command: 'ls' });
    expect(result.output).toContain('file1.txt');
    expect(result.output).toContain('file2.txt');
    expect(result.metadata).toEqual({ command: 'ls', exitCode: 0 });
  });

  it('returns exit code and stderr on failure', async () => {
    const sandbox = createMockSandbox({
      stdout: '',
      stderr: 'command not found: foo',
      exitCode: 127,
    });
    const tool = createShellTool(sandbox);

    const result = await tool.execute({ command: 'foo' });
    expect(result.output).toContain('Exit code: 127');
    expect(result.output).toContain('command not found: foo');
    expect(result.metadata?.exitCode).toBe(127);
  });

  it('returns both stdout and stderr on non-zero exit', async () => {
    const sandbox = createMockSandbox({
      stdout: 'partial output',
      stderr: 'some error',
      exitCode: 1,
    });
    const tool = createShellTool(sandbox);

    const result = await tool.execute({ command: 'test' });
    expect(result.output).toContain('partial output');
    expect(result.output).toContain('some error');
  });

  it('returns no output message when stdout is empty on success', async () => {
    const sandbox = createMockSandbox({ stdout: '', stderr: '', exitCode: 0 });
    const tool = createShellTool(sandbox);

    const result = await tool.execute({ command: 'true' });
    expect(result.output).toContain('(no output)');
  });

  it('truncates long output', async () => {
    const longOutput = 'x'.repeat(60_000);
    const sandbox = createMockSandbox({ stdout: longOutput, stderr: '', exitCode: 0 });
    const tool = createShellTool(sandbox);

    const result = await tool.execute({ command: 'cat bigfile' });
    expect(result.output.length).toBeLessThan(longOutput.length);
    expect(result.output).toContain('output truncated');
  });

  it('handles sandbox execution error', async () => {
    const sandbox = createMockSandbox();
    (sandbox.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('WASM module not found'));

    const tool = createShellTool(sandbox);
    const result = await tool.execute({ command: 'ls' });
    expect(result.output).toContain('Error');
    expect(result.output).toContain('WASM module not found');
  });

  it('passes command to sandbox.run', async () => {
    const sandbox = createMockSandbox();
    const tool = createShellTool(sandbox);

    await tool.execute({ command: 'echo hello' });
    expect(sandbox.run).toHaveBeenCalledWith('echo hello');
  });
});
