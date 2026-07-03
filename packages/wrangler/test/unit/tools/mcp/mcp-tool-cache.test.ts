import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MCPToolCache } from '../../../../src/tools/mcp/mcp-tool-cache.js';

// vi.mock is hoisted before imports. Using var (not const/let) avoids TDZ.
var mockFns = {
  loadServerDefinitions: function (_opts: { configPath?: string }) {
    return Promise.resolve([]);
  },
  shouldCreateRuntimeFail: false,
  listTools: function () {
    return Promise.resolve([]);
  },
  callTool: function () {
    return Promise.resolve('');
  },
  // BUG9: track registered servers for incremental registration
  registeredServers: new Set<string>(),
  listServers: function () {
    return Array.from(mockFns.registeredServers);
  },
  registerDefinition: function (def: { name: string }) {
    mockFns.registeredServers.add(def.name);
  },
};

vi.mock('mcporter', () => ({
  loadServerDefinitions: vi
    .fn()
    .mockImplementation((...args: unknown[]) =>
      mockFns.loadServerDefinitions(...(args as [{ configPath?: string }]))
    ),
  createRuntime: vi.fn().mockImplementation((opts?: { servers?: Array<{ name: string }> }) => {
    if (mockFns.shouldCreateRuntimeFail) {
      return Promise.reject(new Error('Runtime init failed'));
    }
    // Simulate mcporter: register initial servers into the set
    if (opts?.servers) {
      for (const s of opts.servers) {
        mockFns.registeredServers.add(s.name);
      }
    }
    return Promise.resolve({
      listTools: (...args: unknown[]) => mockFns.listTools(...args),
      callTool: (...args: unknown[]) => mockFns.callTool(...args),
      listServers: () => mockFns.listServers(),
      registerDefinition: (def: { name: string }) => mockFns.registerDefinition(def),
    });
  }),
}));

describe('MCPToolCache', () => {
  let cache: MCPToolCache;

  beforeEach(() => {
    cache = new MCPToolCache();
    mockFns.shouldCreateRuntimeFail = false;
    mockFns.registeredServers = new Set();
    mockFns.loadServerDefinitions = () => Promise.resolve([]);
    mockFns.listTools = () => Promise.resolve([]);
    mockFns.callTool = () => Promise.resolve('');
  });

  it('returns empty array for empty configPaths', async () => {
    const tools = await cache.getTools([]);
    expect(tools).toEqual([]);
  });

  it('returns empty array for undefined configPaths', async () => {
    const tools = await cache.getTools(undefined);
    expect(tools).toEqual([]);
  });

  it('returns cached tools on second call with same configPaths', async () => {
    mockFns.loadServerDefinitions = () =>
      Promise.resolve([
        { name: 'srv', command: { kind: 'http', url: new URL('http://localhost') } },
      ]);
    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);

    const paths = ['/fake/config.json'];
    const tools1 = await cache.getTools(paths);
    const tools2 = await cache.getTools(paths);

    expect(tools1).toHaveLength(1);
    expect(tools2).toHaveLength(1);
    expect(tools2).toBe(tools1);
  });

  it('returns different tools for different configPaths', async () => {
    let callCount = 0;
    mockFns.loadServerDefinitions = () => {
      callCount++;
      return Promise.resolve([
        {
          name: `srv-${callCount}`,
          command: { kind: 'http', url: new URL('http://localhost') },
        },
      ]);
    };
    mockFns.listTools = (serverName: string) =>
      Promise.resolve([
        {
          name: 'tool',
          description: `Tool from ${serverName}`,
          inputSchema: { type: 'object', properties: {} },
        },
      ]);

    const toolsA = await cache.getTools(['/config-a.json']);
    const toolsB = await cache.getTools(['/config-b.json']);

    expect(toolsA).toHaveLength(1);
    expect(toolsB).toHaveLength(1);
    expect(toolsA).not.toBe(toolsB);
  });

  it('treats same paths in different order as different keys', async () => {
    let callCount = 0;
    mockFns.loadServerDefinitions = () => {
      callCount++;
      return Promise.resolve([
        {
          name: `srv-${callCount}`,
          command: { kind: 'http', url: new URL('http://localhost') },
        },
      ]);
    };
    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);

    const tools1 = await cache.getTools(['/a.json', '/b.json']);
    const tools2 = await cache.getTools(['/b.json', '/a.json']);

    expect(tools1).not.toBe(tools2);
  });

  it('creates Runtime only once across multiple getTools calls', async () => {
    const { createRuntime } = await import('mcporter');
    // Reset call count from previous tests
    vi.mocked(createRuntime).mockClear();

    mockFns.loadServerDefinitions = () =>
      Promise.resolve([
        { name: 'srv', command: { kind: 'http', url: new URL('http://localhost') } },
      ]);
    mockFns.listTools = () => Promise.resolve([]);

    await cache.getTools(['/a.json']);
    await cache.getTools(['/b.json']);

    expect(createRuntime).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when createRuntime fails', async () => {
    mockFns.shouldCreateRuntimeFail = true;
    mockFns.loadServerDefinitions = () =>
      Promise.resolve([
        { name: 'srv', command: { kind: 'http', url: new URL('http://localhost') } },
      ]);

    const tools = await cache.getTools(['/config.json']);
    expect(tools).toEqual([]);
  });

  it('returns empty array when loadServerDefinitions fails', async () => {
    mockFns.loadServerDefinitions = () => Promise.reject(new Error('bad config'));

    const tools = await cache.getTools(['/bad.json']);
    expect(tools).toEqual([]);
  });

  it('continues when listTools fails for one server', async () => {
    mockFns.loadServerDefinitions = () =>
      Promise.resolve([
        { name: 'srv', command: { kind: 'http', url: new URL('http://localhost') } },
      ]);
    mockFns.listTools = () => Promise.reject(new Error('unavailable'));

    const tools = await cache.getTools(['/config.json']);
    expect(tools).toEqual([]);
  });

  it('shutdown clears cache', async () => {
    mockFns.loadServerDefinitions = () =>
      Promise.resolve([
        { name: 'srv', command: { kind: 'http', url: new URL('http://localhost') } },
      ]);
    mockFns.listTools = () =>
      Promise.resolve([
        { name: 'tool', description: 'Test', inputSchema: { type: 'object', properties: {} } },
      ]);

    const paths = ['/config.json'];
    await cache.getTools(paths);
    cache.shutdown();

    const tools = await cache.getTools(paths);
    expect(tools).toHaveLength(1);
  });

  // BUG9: new config paths with new servers must be registered into the
  // existing runtime (not silently ignored).
  it('BUG9: second config with a new server registers it into the existing runtime', async () => {
    // First load: server "srv1"
    mockFns.loadServerDefinitions = (opts: { configPath?: string }) => {
      if (opts.configPath === '/config1.json') {
        return Promise.resolve([{ name: 'srv1', command: { kind: 'stdio', command: 'echo' } }]);
      }
      return Promise.resolve([]);
    };
    mockFns.listTools = () => Promise.resolve([]);

    await cache.getTools(['/config1.json']);
    // srv1 should be registered now
    expect(mockFns.registeredServers.has('srv1')).toBe(true);

    // Second load: different config with a NEW server "srv2"
    mockFns.loadServerDefinitions = (opts: { configPath?: string }) => {
      if (opts.configPath === '/config2.json') {
        return Promise.resolve([{ name: 'srv2', command: { kind: 'stdio', command: 'echo' } }]);
      }
      return Promise.resolve([]);
    };

    await cache.getTools(['/config2.json']);
    // srv2 must also be registered — BUG9: it was silently ignored before
    expect(mockFns.registeredServers.has('srv2')).toBe(true);
    // srv1 should still be there
    expect(mockFns.registeredServers.has('srv1')).toBe(true);
  });
});
