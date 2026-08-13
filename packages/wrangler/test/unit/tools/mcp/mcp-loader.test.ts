import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMCPTools, _resetCache } from '../../../../src/tools/mcp/mcp-loader.js';

// vi.mock is hoisted before imports. Using var (not const/let) avoids TDZ.
const mockFns = {
  shouldCreateRuntimeFail: false,
  loadServerDefinitions: function (opts: { configPath?: string }) {
    const fs = require('node:fs');
    try {
      const content = fs.readFileSync(opts.configPath, 'utf-8');
      const config = JSON.parse(content);
      const servers = config.mcpServers || {};
      return Promise.resolve(
        Object.entries(servers).map(([name, def]) => {
          const serverDef = def as Record<string, unknown>;
          if (serverDef.url) {
            return { name, command: { kind: 'http', url: new URL(serverDef.url as string) } };
          }
          return { name, command: { kind: 'http', url: new URL('http://localhost') } };
        })
      );
    } catch {
      return Promise.resolve([]);
    }
  },
  listTools: function () {
    return Promise.resolve([]);
  },
  callTool: function () {
    return Promise.resolve('');
  },
};

vi.mock('mcporter', () => ({
  loadServerDefinitions: vi
    .fn()
    .mockImplementation((...args: unknown[]) => mockFns.loadServerDefinitions(...args)),
  createRuntime: vi.fn().mockImplementation(() => {
    if (mockFns.shouldCreateRuntimeFail) {
      return Promise.reject(new Error('Runtime init failed'));
    }
    return Promise.resolve({
      listTools: (...args: unknown[]) => mockFns.listTools(...args),
      callTool: (...args: unknown[]) => mockFns.callTool(...args),
    });
  }),
}));

describe('loadMCPTools', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wrangler-mcp-loader-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    mockFns.shouldCreateRuntimeFail = false;
    mockFns.loadServerDefinitions = function (opts: { configPath?: string }) {
      const fs = require('node:fs');
      try {
        const content = fs.readFileSync(opts.configPath, 'utf-8');
        const config = JSON.parse(content);
        const servers = config.mcpServers || {};
        return Promise.resolve(
          Object.entries(servers).map(([name, def]) => {
            const serverDef = def as Record<string, unknown>;
            if (serverDef.url) {
              return { name, command: { kind: 'http', url: new URL(serverDef.url as string) } };
            }
            return { name, command: { kind: 'http', url: new URL('http://localhost') } };
          })
        );
      } catch {
        return Promise.resolve([]);
      }
    };
    mockFns.listTools = () => Promise.resolve([]);
    mockFns.callTool = () => Promise.resolve('');
  });

  afterEach(async () => {
    await _resetCache();
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  // ─── No-config cases ───

  it('returns empty when called with no options', async () => {
    const tools = await loadMCPTools();
    expect(tools).toEqual([]);
  });

  it('returns empty when configPaths is empty', async () => {
    const tools = await loadMCPTools({ configPaths: [] });
    expect(tools).toEqual([]);
  });

  it('returns empty when config file has no servers', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }));

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools).toEqual([]);
  });

  it('returns empty when config file does not exist', async () => {
    const tools = await loadMCPTools({ configPaths: ['/nonexistent/mcp.json'] });
    expect(tools).toEqual([]);
  });

  it('returns empty when config file has invalid JSON', async () => {
    const configPath = join(testDir, 'bad.json');
    await writeFile(configPath, '{ invalid json }');

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools).toEqual([]);
  });

  // ─── Single config ───

  it('loads tools from a single config', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { 'test-srv': { url: 'http://localhost:1234/mcp' } },
      })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} } },
      ]);

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test-srv__search');
  });

  // ─── Multiple configs merge ───

  it('merges tools from multiple configs', async () => {
    const configA = join(testDir, 'a.json');
    const configB = join(testDir, 'b.json');

    await writeFile(
      configA,
      JSON.stringify({ mcpServers: { 'srv-a': { url: 'http://a:1234/mcp' } } })
    );
    await writeFile(
      configB,
      JSON.stringify({ mcpServers: { 'srv-b': { url: 'http://b:5678/mcp' } } })
    );

    const loadedServers: string[] = [];
    mockFns.listTools = (serverName: string) => {
      loadedServers.push(serverName);
      return Promise.resolve([
        {
          name: 'tool',
          description: `${serverName} tool`,
          inputSchema: { type: 'object', properties: {} },
        },
      ]);
    };

    const tools = await loadMCPTools({ configPaths: [configA, configB] });
    expect(loadedServers).toContain('srv-a');
    expect(loadedServers).toContain('srv-b');
    expect(tools).toHaveLength(2);
  });

  it('later config overrides earlier on server name collision', async () => {
    const configA = join(testDir, 'a.json');
    const configB = join(testDir, 'b.json');

    await writeFile(
      configA,
      JSON.stringify({ mcpServers: { shared: { url: 'http://a:1234/mcp' } } })
    );
    await writeFile(
      configB,
      JSON.stringify({ mcpServers: { shared: { url: 'http://b:5678/mcp' } } })
    );

    const loadedServers: string[] = [];
    mockFns.listTools = (serverName: string) => {
      loadedServers.push(serverName);
      return Promise.resolve([
        {
          name: 'tool',
          description: `${serverName} tool`,
          inputSchema: { type: 'object', properties: {} },
        },
      ]);
    };

    const tools = await loadMCPTools({ configPaths: [configA, configB] });
    // Only one 'shared' server (B version won the collision)
    expect(loadedServers.filter((s) => s === 'shared')).toHaveLength(1);
    expect(tools).toHaveLength(1);
  });

  // ─── Tool conversion ───

  it('converts MCP tools with correct naming and description', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { 'test-server': { url: 'http://localhost:1234/mcp' } },
      })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        {
          name: 'search',
          description: 'Search items',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
        { name: 'get', description: 'Get item', inputSchema: undefined },
      ]);

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('test-server__search');
    expect(tools[0].description).toBe('Search items');
    expect(tools[1].name).toBe('test-server__get');
    expect(tools[1].description).toBe('Get item');
  });

  it('uses fallback description when tool has no description', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'nodesc', description: '', inputSchema: { type: 'object', properties: {} } },
      ]);

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools[0].description).toBe('MCP tool nodesc from srv');
  });

  // ─── Execute behavior ───

  it('tool execute returns string result', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.resolve('hello from MCP');

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(await tools[0].execute({})).toBe('hello from MCP');
  });

  it('tool execute extracts .text from object result', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.resolve({ text: 'plain text' });

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(await tools[0].execute({})).toBe('plain text');
  });

  it('tool execute extracts .content string', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.resolve({ content: 'content string' });

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(await tools[0].execute({})).toBe('content string');
  });

  it('tool execute extracts text from .content array', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.resolve({ content: [{ type: 'text', text: 'hello' }] });

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(await tools[0].execute({})).toBe('hello');
  });

  it('tool execute handles content array with non-text elements', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () =>
      Promise.resolve({
        content: [
          { type: 'image', data: 'base64' },
          { type: 'text', text: 'hello' },
        ],
      });

    const tools = await loadMCPTools({ configPaths: [configPath] });
    const result = await tools[0].execute({});
    expect(result).toContain('hello');
    expect(result).toContain('"type":"image"');
  });

  it('tool execute JSON-stringifies unknown object result', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.resolve({ data: 42 });

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(await tools[0].execute({})).toBe('{"data":42}');
  });

  it('tool execute handles non-string non-object result', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.resolve(42);

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(await tools[0].execute({})).toBe('42');
  });

  // ─── Error handling ───

  it('tool execute handles callTool Error', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.reject(new Error('Connection refused'));

    const tools = await loadMCPTools({ configPaths: [configPath] });
    const result = await tools[0].execute({});
    expect(result).toContain('Error calling MCP tool srv__tool');
    expect(result).toContain('Connection refused');
  });

  it('tool execute handles callTool non-Error throw', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);
    mockFns.callTool = () => Promise.reject('string error');

    const tools = await loadMCPTools({ configPaths: [configPath] });
    const result = await tools[0].execute({});
    expect(result).toContain('Error calling MCP tool srv__tool');
    expect(result).toContain('string error');
  });

  it('continues when listTools fails for one server', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () => Promise.reject(new Error('Server unavailable'));

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools).toEqual([]);
  });

  it('handles createRuntime failure gracefully', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.shouldCreateRuntimeFail = true;

    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools).toEqual([]);
  });

  it('safeLoadDefinitions catches non-Error from loadServerDefinitions', async () => {
    mockFns.loadServerDefinitions = () => Promise.reject('raw rejection');

    const tools = await loadMCPTools({ configPaths: ['/nonexistent.json'] });
    expect(tools).toEqual([]);
  });

  // ─── Caching ───

  it('delegates to MCPToolCache and returns cached tools on second call', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);

    const tools1 = await loadMCPTools({ configPaths: [configPath] });
    const tools2 = await loadMCPTools({ configPaths: [configPath] });

    expect(tools1).toHaveLength(1);
    expect(tools2).toBe(tools1);
  });

  // --- Negative paths (W3-3) ---

  it('handles concurrent loadMCPTools calls — all resolve without error', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { srv: { url: 'http://localhost/mcp' } } })
    );

    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);

    // Fire concurrent calls — should all complete without race condition errors
    const [tools1, tools2, tools3] = await Promise.all([
      loadMCPTools({ configPaths: [configPath] }),
      loadMCPTools({ configPaths: [configPath] }),
      loadMCPTools({ configPaths: [configPath] }),
    ]);

    // All should resolve successfully with correct tool count
    expect(tools1).toHaveLength(1);
    expect(tools2).toHaveLength(1);
    expect(tools3).toHaveLength(1);
    // Tool names should be consistent
    expect(tools1[0]!.name).toBe('srv__tool');
    expect(tools2[0]!.name).toBe('srv__tool');
    expect(tools3[0]!.name).toBe('srv__tool');
  });

  it('handles malformed server config — missing URL', async () => {
    const configPath = join(testDir, 'mcp-malformed.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { srv: {} } }));

    // loadServerDefinitions returns empty array when parsing fails
    const tools = await loadMCPTools({ configPaths: [configPath] });
    expect(tools).toEqual([]);
  });
});
