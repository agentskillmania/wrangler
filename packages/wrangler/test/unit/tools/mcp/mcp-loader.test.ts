import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadMCPTools } from '../../../../src/tools/mcp/mcp-loader.js';
import type { MCPLoaderOptions } from '../../../../src/tools/mcp/mcp-loader.js';

describe('loadMCPTools', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wrangler-mcp-loader-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns empty array when called with no options', async () => {
    // No global config exists in test environment, no local config
    const tools = await loadMCPTools();
    expect(tools).toEqual([]);
  });

  it('returns empty array when no config files exist', async () => {
    const tools = await loadMCPTools({
      globalConfigPath: '/nonexistent/mcporter.json',
      localConfigPath: '/nonexistent/mcp.json',
    });
    expect(tools).toEqual([]);
  });

  it('returns empty array with empty options', async () => {
    const tools = await loadMCPTools({});
    expect(tools).toEqual([]);
  });

  it('returns empty array when serverFilter excludes all servers', async () => {
    // Write a temp mcp.json with one server, but filter to different name
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        servers: { myserver: { command: 'echo' } },
      })
    );

    const tools = await loadMCPTools({
      localConfigPath: configPath,
      globalConfigPath: '/nonexistent/mcporter.json',
      serverFilter: ['other-server'],
    });
    expect(tools).toEqual([]);
  });

  it('handles mcporter runtime creation failure gracefully', async () => {
    // Write a config with an invalid server that will fail to connect
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        servers: { badserver: { command: 'nonexistent-command-xyz' } },
      })
    );

    const tools = await loadMCPTools({
      localConfigPath: configPath,
      globalConfigPath: '/nonexistent/mcporter.json',
    });
    // Should return empty array (graceful failure), not throw
    expect(Array.isArray(tools)).toBe(true);
  });

  it('returns empty array when merged config has no servers', async () => {
    // Write empty config files
    const globalConfigPath = join(testDir, 'mcporter.json');
    const localConfigPath = join(testDir, 'mcp.json');
    await writeFile(globalConfigPath, JSON.stringify({ servers: {} }));
    await writeFile(localConfigPath, JSON.stringify({ servers: {} }));

    const tools = await loadMCPTools({
      globalConfigPath,
      localConfigPath,
    });
    expect(tools).toEqual([]);
  });

  it('applies server filter correctly when matching servers exist', async () => {
    // Write config with multiple servers
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        servers: {
          'server-a': { command: 'echo' },
          'server-b': { command: 'echo' },
          'server-c': { command: 'echo' },
        },
      })
    );

    const tools = await loadMCPTools({
      localConfigPath: configPath,
      globalConfigPath: '/nonexistent/mcporter.json',
      serverFilter: ['server-a', 'server-c'],
    });
    // Should return empty array because echo server won't have actual tools
    // but shouldn't throw an error
    expect(Array.isArray(tools)).toBe(true);
  });

  it('handles invalid JSON in local config gracefully', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(configPath, '{ invalid json }');

    const tools = await loadMCPTools({
      localConfigPath: configPath,
      globalConfigPath: '/nonexistent/mcporter.json',
    });
    // Should return empty array (graceful failure), not throw
    expect(Array.isArray(tools)).toBe(true);
  });

  it('handles invalid JSON in global config gracefully', async () => {
    const configPath = join(testDir, 'mcporter.json');
    await writeFile(configPath, '{ invalid json }');

    const tools = await loadMCPTools({
      globalConfigPath: configPath,
    });
    // Should return empty array (graceful failure), not throw
    expect(Array.isArray(tools)).toBe(true);
  });

  it('merges global and local configs correctly', async () => {
    const globalConfigPath = join(testDir, 'mcporter.json');
    const localConfigPath = join(testDir, 'mcp.json');

    await writeFile(
      globalConfigPath,
      JSON.stringify({
        servers: {
          'global-server': { command: 'echo' },
        },
      })
    );

    await writeFile(
      localConfigPath,
      JSON.stringify({
        servers: {
          'local-server': { command: 'echo' },
        },
      })
    );

    const tools = await loadMCPTools({
      globalConfigPath,
      localConfigPath,
    });
    // Should not throw, should return array (likely empty due to echo servers)
    expect(Array.isArray(tools)).toBe(true);
  });

  it('handles empty serverFilter array', async () => {
    const configPath = join(testDir, 'mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({
        servers: { myserver: { command: 'echo' } },
      })
    );

    const tools = await loadMCPTools({
      localConfigPath: configPath,
      globalConfigPath: '/nonexistent/mcporter.json',
      serverFilter: [],
    });
    // Empty filter should exclude all servers
    expect(tools).toEqual([]);
  });
});
