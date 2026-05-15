import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createShellTool } from '../../../../src/tools/builtin/shell.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

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
});
