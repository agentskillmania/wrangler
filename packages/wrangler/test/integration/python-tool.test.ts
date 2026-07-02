/**
 * @fileoverview Integration test: python tool user story.
 *
 * User story: As a developer agent, I want to execute Python code or scripts
 * so that I can run computations and automation in the workspace.
 *
 * Layer: INTEGRATION — uses a real HostToolDeps, real filesystem, and the real
 * python3 binary. No mocks. Validates end-to-end that the python tool
 * correctly runs code and scripts via execArray (the SEC4 fix path).
 *
 * Skipped if python3 is not available on the host.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createPythonTool } from '../../src/tools/builtin/python.js';
import { HostToolDeps } from '../../src/tools/builtin/workspace-deps.js';

const PYTHON_AVAILABLE = (() => {
  try {
    execSync('python3 --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!PYTHON_AVAILABLE)('Integration: python tool (real python3)', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'wrangler-int-python-'));
    deps = new HostToolDeps(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('executes inline python code', async () => {
    const tool = createPythonTool(deps);
    const result = await tool.execute({ code: 'print(42)' });
    expect(result).toContain('42');
  });

  it('reports python errors with traceback', async () => {
    const tool = createPythonTool(deps);
    const result = await tool.execute({ code: 'raise ValueError("test error")' });
    expect(result).toContain('test error');
  });

  it('executes a python script file', async () => {
    writeFileSync(join(workspace, 'script.py'), 'print("from file")');
    const tool = createPythonTool(deps);
    const result = await tool.execute({ file: 'script.py' });
    expect(result).toContain('from file');
  });
});
