import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCoreTools } from '../../../../src/tools/builtin/index.js';
import { createWebTools } from '../../../../src/tools/web/index.js';
import { HostToolDeps, SandboxToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';
import type { SearchProvider } from '../../../../src/tools/builtin/web-search.js';

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
  it('returns 9 colts Tool instances (calculator + 8 platform-neutral builtin)', () => {
    const tools = createCoreTools({ deps: makeDeps() });
    expect(tools).toHaveLength(9);
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
    // list_dir 已移除（R2P-240，对齐 Rust 128e109）：与 shell ls 完全重叠
    expect(names).not.toContain('list_dir');
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
    expect(tools).toHaveLength(9);
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

  /** Bing-shaped results page for stubbed fetch. */
  const BING_HTML = `
    <html><body><ol>
      <li class="b_algo"><h2><a href="https://example.com/bing-1">Bing Result</a></h2>
        <p class="b_lineclamp2">A bing snippet</p></li>
    </ol></body></html>`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('default assembly falls back to bing results when sogou is challenged (R2P-243)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const u = url.toString();
        if (u.includes('sogou.com')) {
          return { ok: false, status: 403, text: () => Promise.resolve('forbidden') };
        }
        if (u.includes('bing.com')) {
          return { ok: true, status: 200, text: () => Promise.resolve(BING_HTML) };
        }
        return { ok: false, status: 404, text: () => Promise.resolve('') };
      })
    );

    const tools = createWebTools({ deps: makeDeps() }); // 默认 = sogou→bing 回退链
    const webSearch = tools.find((t) => t.name === 'web_search')!;
    const output = await webSearch.execute({ query: 'test' });

    expect(output).toContain('https://example.com/bing-1');
    expect(output).not.toContain('No results found');
  });

  it('explicit bing provider answers directly without sogou', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      return { ok: true, status: 200, text: () => Promise.resolve(BING_HTML) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const tools = createWebTools({ deps: makeDeps(), provider: 'bing' });
    const webSearch = tools.find((t) => t.name === 'web_search')!;
    const output = await webSearch.execute({ query: 'test' });

    expect(output).toContain('https://example.com/bing-1');
    const calls = fetchMock.mock.calls.map((c) => c[0].toString());
    expect(calls.some((c) => c.includes('sogou.com'))).toBe(false);
  });

  it('passes a custom SearchProvider instance through untouched', async () => {
    const custom: SearchProvider = {
      search: async () => [{ title: 'Custom', url: 'https://example.com/custom', snippet: 's' }],
    };
    const tools = createWebTools({ deps: makeDeps(), provider: custom });
    const webSearch = tools.find((t) => t.name === 'web_search')!;
    const output = await webSearch.execute({ query: 'test' });

    expect(output).toContain('https://example.com/custom');
  });
});
