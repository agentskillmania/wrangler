/**
 * US2: Shell tool integration
 *
 * Real sandbox-based shell tool that executes commands via WASM.
 * Requires wasmtime and busybox.wasm to be available.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Sandbox } from '@agentskillmania/sandbox';
import { createShellTool } from '../../src/tools/builtin/shell.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

// Probe synchronously at module load time so itif gets the right value
let sandboxAvailable = false;
let sandbox: Sandbox;
let sandboxDir: string;

// Top-level await: vitest supports ESM top-level await
try {
  sandboxDir = join(tmpdir(), `wrangler-shell-intg-${Date.now()}`);
  await mkdir(sandboxDir, { recursive: true });
  sandbox = new Sandbox({ sandboxDir, timeout: 15000 });
  const result = await sandbox.run('echo probe');
  sandboxAvailable = result.exitCode === 0;
} catch {
  sandboxAvailable = false;
}

const itif = (condition: boolean) => (condition ? it : it.skip);

afterAll(async () => {
  if (sandboxDir) {
    await rm(sandboxDir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('US2: Shell tool (real sandbox)', () => {
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
