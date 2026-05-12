import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  MCPServerDef,
  MCPConfig,
  mergeMCPConfigs,
  readConfigFile,
  discoverGlobalConfigPath,
} from '../../../../src/tools/mcp/config-merger.js';

describe('config-merger', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `wrangler-test-mcp-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('mergeMCPConfigs', () => {
    it('returns empty config when both configs are undefined', () => {
      const result = mergeMCPConfigs();
      expect(result).toEqual({ servers: {} });
    });

    it('returns empty config when both configs are empty', () => {
      const global: MCPConfig = { servers: {} };
      const local: MCPConfig = { servers: {} };
      const result = mergeMCPConfigs(global, local);
      expect(result).toEqual({ servers: {} });
    });

    it('returns global-only servers', () => {
      const global: MCPConfig = {
        servers: {
          'server-a': { command: 'cmd-a' },
          'server-b': { command: 'cmd-b' },
        },
      };
      const result = mergeMCPConfigs(global);
      expect(result).toEqual(global);
    });

    it('returns local-only servers', () => {
      const local: MCPConfig = {
        servers: {
          'server-x': { command: 'cmd-x' },
          'server-y': { command: 'cmd-y' },
        },
      };
      const result = mergeMCPConfigs(undefined, local);
      expect(result).toEqual(local);
    });

    it('merges global and local configs', () => {
      const global: MCPConfig = {
        servers: {
          'server-a': { command: 'cmd-a' },
          'server-b': { command: 'cmd-b' },
        },
      };
      const local: MCPConfig = {
        servers: {
          'server-x': { command: 'cmd-x' },
          'server-y': { command: 'cmd-y' },
        },
      };
      const result = mergeMCPConfigs(global, local);
      expect(result.servers).toEqual({
        'server-a': { command: 'cmd-a' },
        'server-b': { command: 'cmd-b' },
        'server-x': { command: 'cmd-x' },
        'server-y': { command: 'cmd-y' },
      });
    });

    it('local overrides global on name collision', () => {
      const global: MCPConfig = {
        servers: {
          'shared-server': { command: 'global-cmd', args: ['--global'] },
          'global-only': { command: 'global-only-cmd' },
        },
      };
      const local: MCPConfig = {
        servers: {
          'shared-server': { command: 'local-cmd', args: ['--local'] },
          'local-only': { command: 'local-only-cmd' },
        },
      };
      const result = mergeMCPConfigs(global, local);
      expect(result.servers).toEqual({
        'shared-server': { command: 'local-cmd', args: ['--local'] },
        'global-only': { command: 'global-only-cmd' },
        'local-only': { command: 'local-only-cmd' },
      });
    });

    it('handles undefined global config', () => {
      const local: MCPConfig = {
        servers: { 'local': { command: 'local-cmd' } },
      };
      const result = mergeMCPConfigs(undefined, local);
      expect(result).toEqual(local);
    });

    it('handles undefined local config', () => {
      const global: MCPConfig = {
        servers: { 'global': { command: 'global-cmd' } },
      };
      const result = mergeMCPConfigs(global, undefined);
      expect(result).toEqual(global);
    });

    it('merges server configs with env vars', () => {
      const global: MCPConfig = {
        servers: {
          'server-with-env': {
            command: 'cmd',
            env: { GLOBAL_VAR: 'global-value' },
          },
        },
      };
      const local: MCPConfig = {
        servers: {
          'server-with-env': {
            command: 'cmd',
            env: { LOCAL_VAR: 'local-value' },
          },
        },
      };
      const result = mergeMCPConfigs(global, local);
      expect(result.servers['server-with-env']).toEqual({
        command: 'cmd',
        env: { LOCAL_VAR: 'local-value' },
      });
    });
  });

  describe('readConfigFile', () => {
    it('reads and parses valid JSON config file', async () => {
      const configPath = join(testDir, 'config.json');
      const configData = {
        servers: {
          'test-server': { command: 'test-cmd', args: ['--test'] },
        },
      };
      await writeFile(configPath, JSON.stringify(configData));
      const result = await readConfigFile(configPath);
      expect(result).toEqual(configData);
    });

    it('returns empty config when file does not exist', async () => {
      const nonExistentPath = join(testDir, 'non-existent.json');
      const result = await readConfigFile(nonExistentPath);
      expect(result).toEqual({ servers: {} });
    });

    it('throws on invalid JSON', async () => {
      const configPath = join(testDir, 'invalid.json');
      await writeFile(configPath, '{ invalid json }');
      await expect(readConfigFile(configPath)).rejects.toThrow();
    });

    it('reads empty config file', async () => {
      const configPath = join(testDir, 'empty.json');
      await writeFile(configPath, '{}');
      const result = await readConfigFile(configPath);
      expect(result).toEqual({});
    });

    it('reads config with servers only', async () => {
      const configPath = join(testDir, 'servers-only.json');
      const configData = {
        servers: {
          'server-a': { command: 'cmd-a' },
          'server-b': { command: 'cmd-b', args: ['--flag'] },
        },
      };
      await writeFile(configPath, JSON.stringify(configData));
      const result = await readConfigFile(configPath);
      expect(result).toEqual(configData);
    });
  });

  describe('discoverGlobalConfigPath', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = process.env;
      process.env = {};
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns explicit path if provided', () => {
      const explicitPath = '/custom/path/config.json';
      const result = discoverGlobalConfigPath(explicitPath);
      expect(result).toBe(explicitPath);
    });

    it('returns path from MCPORTER_CONFIG env var if no explicit path', () => {
      process.env.MCPORTER_CONFIG = '/env/config/path.json';
      const result = discoverGlobalConfigPath();
      expect(result).toBe('/env/config/path.json');
    });

    it('explicit path takes precedence over env var', () => {
      process.env.MCPORTER_CONFIG = '/env/config/path.json';
      const explicitPath = '/explicit/path/config.json';
      const result = discoverGlobalConfigPath(explicitPath);
      expect(result).toBe(explicitPath);
    });

    it('returns default path when no explicit path or env var', () => {
      const result = discoverGlobalConfigPath();
      expect(result).toBe(join(homedir(), '.mcporter', 'mcporter.json'));
    });

    it('handles empty MCPORTER_CONFIG env var', () => {
      process.env.MCPORTER_CONFIG = '';
      const result = discoverGlobalConfigPath();
      expect(result).toBe(join(homedir(), '.mcporter', 'mcporter.json'));
    });

    it('handles undefined HOME in default path', () => {
      delete process.env.HOME;
      const result = discoverGlobalConfigPath();
      // homedir() returns a fallback even without HOME env var
      expect(result).toMatch(/\.mcporter\/mcporter\.json$/);
    });
  });
});
