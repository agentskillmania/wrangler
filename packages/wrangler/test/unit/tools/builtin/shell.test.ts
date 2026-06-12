import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createShellTool } from '../../../../src/tools/builtin/shell.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { createMockToolDeps } from '../../helpers/create-mock-deps.js';

describe('createShellTool', () => {
  let tempDir: string;
  let deps: ToolDeps;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'shell-test-'));
    deps = new HostToolDeps(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should execute echo command via ToolDeps', async () => {
    const tool = createShellTool(deps);
    const result = await tool.execute({ command: 'echo hello from shell' });
    expect(result).toContain('hello from shell');
  });

  it('should report non-zero exit code', async () => {
    const tool = createShellTool(deps);
    const result = await tool.execute({ command: 'ls /nonexistent_dir_xyz_12345' });
    expect(result).toContain('Exit code');
  });

  it('should truncate large output', async () => {
    const tool = createShellTool(deps);
    const result = await tool.execute({ command: 'seq 1 100000' });
    expect(result.length).toBeLessThan(100_000);
  });

  describe('description', () => {
    it('should include shell info in description when deps has shell', () => {
      const tool = createShellTool(deps);
      expect(tool.description).toContain('Current shell:');
      expect(tool.description).toContain(deps.shell!.name);
      expect(tool.description).toContain(deps.shell!.path);
    });

    it('should not include shell info when deps has no shell property', () => {
      const minimalDeps = createMockToolDeps({
        workspaceRoot: tempDir,
        resolvePath: (p: string) => join(tempDir, p),
      });
      const tool = createShellTool(minimalDeps);
      expect(tool.description).not.toContain('Current shell:');
      expect(tool.description).toBe('Execute shell commands in the workspace.');
    });
  });

  it('should propagate exec errors', async () => {
    const throwingDeps = createMockToolDeps({
      workspaceRoot: tempDir,
      resolvePath: (p: string) => join(tempDir, p),
      exec: async () => {
        throw 'string error';
      },
    });
    const tool = createShellTool(throwingDeps);
    await expect(tool.execute({ command: 'anything' })).rejects.toThrow('string error');
  });

  it('should show (no output) when stdout is empty on success', async () => {
    const depsNoOutput = createMockToolDeps({
      workspaceRoot: tempDir,
      resolvePath: (p: string) => join(tempDir, p),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    });
    const tool = createShellTool(depsNoOutput);
    const result = await tool.execute({ command: 'true' });
    expect(result).toBe('(no output)');
  });

  it('should include stdout in error output', async () => {
    const depsWithStdout = createMockToolDeps({
      workspaceRoot: tempDir,
      resolvePath: (p: string) => join(tempDir, p),
      exec: vi.fn().mockResolvedValue({
        stdout: 'partial output',
        stderr: 'error msg',
        exitCode: 1,
      }),
    });
    const tool = createShellTool(depsWithStdout);
    const result = await tool.execute({ command: 'fail' });
    expect(result).toContain('Exit code: 1');
    expect(result).toContain('partial output');
    expect(result).toContain('error msg');
  });

  describe('schema validation', () => {
    it('rejects arguments missing the command field', () => {
      const tool = createShellTool(deps);
      expect(() => tool.parameters.parse({})).toThrow();
    });

    it('rejects non-string command argument', () => {
      const tool = createShellTool(deps);
      expect(() => tool.parameters.parse({ command: 123 })).toThrow();
    });

    it('accepts valid command argument', () => {
      const tool = createShellTool(deps);
      expect(tool.parameters.parse({ command: 'echo hi' })).toEqual({
        command: 'echo hi',
      });
    });
  });
});
