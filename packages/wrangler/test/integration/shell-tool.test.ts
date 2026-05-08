/**
 * US2: Shell tool integration
 *
 * Real sandbox-based shell tool that executes commands via WASM.
 * Requires wasmtime and busybox.wasm to be available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sandbox } from '@agentskillmania/sandbox';
import { createShellTool } from '../../src/tools/builtin/shell.js';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

// Probe: try creating a sandbox and running a command to detect availability
let sandboxAvailable = false;

async function probeSandbox(): Promise<boolean> {
  try {
    const dir = join(tmpdir(), `wrangler-shell-probe-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const sb = new Sandbox({ sandboxDir: dir, timeout: 10000 });
    const result = await sb.run('echo ok');
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const itif = (condition: boolean) => (condition ? it : it.skip);

describe('US2: Shell tool (real sandbox)', () => {
  let sandbox: Sandbox;
  let sandboxDir: string;

  beforeAll(async () => {
    sandboxAvailable = await probeSandbox();
    if (!sandboxAvailable) return;

    sandboxDir = join(tmpdir(), `wrangler-shell-intg-${Date.now()}`);
    await mkdir(sandboxDir, { recursive: true });
    sandbox = new Sandbox({ sandboxDir: sandboxDir, timeout: 15000 });
  });

  afterAll(async () => {
    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  itif(sandboxAvailable)('executes echo command', async () => {
    const tool = createShellTool(sandbox);
    const result = await tool.execute({ command: 'echo hello' });
    expect(result).toContain('hello');
  });

  itif(sandboxAvailable)('executes ls and returns file listing', async () => {
    const tool = createShellTool(sandbox);
    const result = await tool.execute({ command: 'ls' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  itif(sandboxAvailable)('returns exit code on failure', async () => {
    const tool = createShellTool(sandbox);
    const result = await tool.execute({ command: 'ls /nonexistent_dir_xyz' });
    expect(result).toContain('Exit code:');
  });

  itif(sandboxAvailable)('handles command with pipe', async () => {
    const tool = createShellTool(sandbox);
    const result = await tool.execute({ command: 'echo "hello world" | cat' });
    expect(result).toContain('hello');
  });

  itif(sandboxAvailable)('returns no output message for empty stdout', async () => {
    const tool = createShellTool(sandbox);
    const result = await tool.execute({ command: 'true' });
    expect(result).toContain('(no output)');
  });

  itif(!sandboxAvailable)('skips all tests when sandbox is not available', () => {
    expect(true).toBe(true);
  });
});
