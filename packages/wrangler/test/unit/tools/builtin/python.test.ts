import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPythonTool } from '../../../../src/tools/builtin/python.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

describe('createPythonTool', () => {
  let tempDir: string;
  let deps: ToolDeps;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'python-test-'));
    deps = new HostToolDeps(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should execute python code', async () => {
    const tool = createPythonTool(deps);
    const result = await tool.execute({ code: 'print(42)' });
    expect(result).toContain('42');
  });

  it('should report python errors', async () => {
    const tool = createPythonTool(deps);
    const result = await tool.execute({ code: 'raise ValueError("test error")' });
    expect(result).toContain('test error');
  });

  it('should execute python file', async () => {
    writeFileSync(join(tempDir, 'script.py'), 'print("from file")');
    const tool = createPythonTool(deps);
    const result = await tool.execute({ file: 'script.py' });
    expect(result).toContain('from file');
  });

  it('should error when no code or file provided', async () => {
    const tool = createPythonTool(deps);
    const result = await tool.execute({});
    expect(result).toContain('Provide either');
  });
});
