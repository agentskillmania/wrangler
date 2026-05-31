import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGitTool } from '../../../../src/tools/builtin/git.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

describe('createGitTool', () => {
  let tempDir: string;
  let deps: ToolDeps;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'git-test-'));
    deps = new HostToolDeps(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should execute git status in initialized repo', async () => {
    await deps.exec('git init');
    const tool = createGitTool(deps);
    const result = await tool.execute({ command: 'status' });
    expect(result).toContain('On branch');
  });

  it('should handle git log on empty repo', async () => {
    await deps.exec('git init');
    const tool = createGitTool(deps);
    const result = await tool.execute({ command: 'log --oneline' });
    expect(typeof result).toBe('string');
  });

  it('should propagate exec errors', async () => {
    const throwingDeps: ToolDeps = {
      workspaceRoot: tempDir,
      maxOutputSize: 1024,
      resolvePath: (p: string) => join(tempDir, p),
      exec: async () => {
        throw new Error('sandbox crashed');
      },
      readFile: async () => '',
      writeFile: async () => {},
      editFile: async () => '',
      glob: async () => [],
      grep: async () => '',
    };
    const tool = createGitTool(throwingDeps);
    await expect(tool.execute({ command: 'status' })).rejects.toThrow('sandbox crashed');
  });

  it('should return no-output marker when stdout is empty on success', async () => {
    const mockDeps: ToolDeps = {
      workspaceRoot: tempDir,
      maxOutputSize: 1024,
      resolvePath: (p: string) => join(tempDir, p),
      exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      readFile: async () => '',
      writeFile: async () => {},
      editFile: async () => '',
      glob: async () => [],
      grep: async () => '',
    };
    const tool = createGitTool(mockDeps);
    const result = await tool.execute({ command: 'status' });
    expect(result).toBe('(no output)');
  });

  it('should format error without stderr when only stdout is present', async () => {
    const mockDeps: ToolDeps = {
      workspaceRoot: tempDir,
      maxOutputSize: 1024,
      resolvePath: (p: string) => join(tempDir, p),
      exec: async () => ({ stdout: 'some output', stderr: '', exitCode: 1 }),
      readFile: async () => '',
      writeFile: async () => {},
      editFile: async () => '',
      glob: async () => [],
      grep: async () => '',
    };
    const tool = createGitTool(mockDeps);
    const result = await tool.execute({ command: 'push' });
    expect(result).toContain('Exit code: 1');
    expect(result).toContain('STDOUT');
    expect(result).not.toContain('STDERR');
  });
});
