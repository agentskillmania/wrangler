import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCoreTools } from '../../../../src/tools/builtin/index.js';
import { createWebTools } from '../../../../src/tools/web/index.js';
import { HostToolDeps, SandboxToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';

// HostToolDeps.exec/execArray now set cwd to workspaceRoot, so tests need
// a real directory (not a fake path like /tmp/test-workspace).
let testWorkspace: string;

beforeAll(() => {
  testWorkspace = mkdtempSync(join(tmpdir(), 'wrangler-unit-builtin-'));
});
afterAll(() => {
  rmSync(testWorkspace, { recursive: true, force: true });
});

function makeDeps() {
  return new HostToolDeps(new NodeHostEnv(), testWorkspace);
}

describe('createCoreTools', () => {
  it('returns 10 colts Tool instances (calculator + 9 platform-neutral builtin)', () => {
    const tools = createCoreTools({ deps: makeDeps() });
    expect(tools).toHaveLength(10);
    for (const tool of tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('parameters');
      expect(tool).toHaveProperty('execute');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('includes all expected tool names', () => {
    const tools = createCoreTools({ deps: makeDeps() });
    const names = tools.map((t) => t.name);
    expect(names).toContain('calculate');
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_edit');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
    expect(names).toContain('shell');
    expect(names).toContain('python');
    expect(names).toContain('git');
    expect(names).toContain('list_dir');
    // web_fetch / web_search 不在 core（走 tools/web 子路径）
    expect(names).not.toContain('web_fetch');
    expect(names).not.toContain('web_search');
  });

  it('passes workspace config to file tools', async () => {
    const tools = createCoreTools({ deps: makeDeps() });
    const fileRead = tools.find((t) => t.name === 'file_read')!;
    // Should attempt to read from workspace path and throw when file missing
    await expect(fileRead.execute({ filePath: 'nonexistent.txt' })).rejects.toThrow(
      'File not found'
    );
  });

  it('shell tool executes commands in host mode', async () => {
    const tools = createCoreTools({ deps: makeDeps() });
    const shell = tools.find((t) => t.name === 'shell')!;
    const result = await shell.execute({ command: 'echo test' });
    expect(result).toContain('test');
  });

  it('python tool executes python code in host mode', async () => {
    const tools = createCoreTools({ deps: makeDeps() });
    const python = tools.find((t) => t.name === 'python')!;
    const result = await python.execute({ code: 'print("hello from python")' });
    expect(result).toContain('hello from python');
  });

  it('git tool executes git commands in host mode', async () => {
    const tools = createCoreTools({ deps: makeDeps() });
    const git = tools.find((t) => t.name === 'git')!;
    const result = await git.execute({ command: '--version' });
    expect(result).toContain('git version');
  });

  it('uses SandboxToolDeps when sandbox deps are provided', async () => {
    const mockSandbox = {
      run: vi.fn().mockResolvedValue({ stdout: 'sandbox output', stderr: '', exitCode: 0 }),
    } as unknown as import('@agentskillmania/sandbox').Sandbox;
    const tools = createCoreTools({
      deps: new SandboxToolDeps(mockSandbox, 100000, 600_000),
    });
    expect(tools).toHaveLength(10);
    const shell = tools.find((t) => t.name === 'shell')!;
    const result = await shell.execute({ command: 'echo hi' });
    expect(result).toContain('sandbox output');
    expect(mockSandbox.run).toHaveBeenCalledWith('echo hi');
  });

  it('passes maxToolOutput to shell tool for truncation', async () => {
    const tools = createCoreTools({
      deps: makeDeps(),
      maxToolOutput: 500,
    });
    const shell = tools.find((t) => t.name === 'shell')!;
    const result = await shell.execute({ command: 'seq 1 100000' });
    expect(result).toContain('output truncated');
    // Output body capped at 500 chars + marker
    expect(result.length).toBeLessThanOrEqual(500 + 50);
  });
});

describe('createWebTools (tools/web subpath)', () => {
  it('assembles web_fetch + web_search with default SogouScrapeSearchProvider', () => {
    const tools = createWebTools({ deps: makeDeps() });
    expect(tools.map((t) => t.name)).toEqual(['web_fetch', 'web_search']);
    const webSearch = tools.find((t) => t.name === 'web_search')!;
    expect(webSearch).toHaveProperty('name', 'web_search');
    expect(webSearch).toHaveProperty('parameters');
    expect(webSearch).toHaveProperty('execute');
  });
});
