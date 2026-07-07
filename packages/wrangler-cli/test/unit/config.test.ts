/**
 * config.ts unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveSetup, getGlobalConfigPath } from '../../src/config.js';

describe('config', () => {
  const testDir = path.join(os.tmpdir(), `wrangler-test-config-${Date.now()}`);
  const globalDir = path.join(testDir, 'global');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(globalDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ---------------------------------------------------------------------------
  // loadConfig
  // ---------------------------------------------------------------------------

  describe('loadConfig', () => {
    it('should return hasValidConfig=false when no config file exists', async () => {
      // Use an isolated empty directory with no local or global config
      const emptyDir = path.join(testDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(emptyDir);

      try {
        const config = await loadConfig({ globalDir: path.join(emptyDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
        expect(config.configPath).toBe(path.join(emptyDir, 'noglobal', 'config.yaml'));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return correct config when valid local config exists', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      apiKey: sk-test-key
      models:
        - modelId: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.providers?.[0]?.name).toBe('openai');
        expect(config.llm?.providers?.[0]?.apiKey).toBe('sk-test-key');
        expect(config.llm?.providers?.[0]?.models?.[0]?.modelId).toBe('gpt-4');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return correct config when valid global config exists', async () => {
      // Ensure no local config exists
      const localOnlyDir = path.join(testDir, 'nolocal');
      await fs.mkdir(localOnlyDir, { recursive: true });

      // Place config in global directory
      const yamlContent = `
llm:
  providers:
    - name: anthropic
      apiKey: sk-ant-test
      models:
        - modelId: claude-3
`;
      await fs.writeFile(path.join(globalDir, 'config.yaml'), yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(localOnlyDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.providers?.[0]?.name).toBe('anthropic');
        expect(config.llm?.providers?.[0]?.apiKey).toBe('sk-ant-test');
        expect(config.llm?.providers?.[0]?.models?.[0]?.modelId).toBe('claude-3');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false when apiKey is missing', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      models:
        - modelId: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false when providers array is empty', async () => {
      const yamlContent = `
llm:
  providers: []
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false for legacy flat LLM config', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-legacy
  model: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false when YAML is empty', async () => {
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, '', 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return loadError when config file is corrupted (ERR7)', async () => {
      // ERR7: a broken config (invalid YAML syntax) must surface as loadError
      // so the caller can tell "no config yet" from "config is broken".
      // Without this the user sees the setup wizard instead of an error.
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, '{ invalid: yaml: content: [[[', 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
        // The key assertion: loadError is set, distinguishing corruption
        // from a simple "not configured yet" state.
        expect(config.loadError).toBeDefined();
        expect(typeof config.loadError).toBe('string');
        expect(config.loadError!.length).toBeGreaterThan(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should NOT set loadError when no config file exists (ERR7)', async () => {
      // "No config yet" is a normal state (setup wizard), not an error.
      const emptyDir = path.join(testDir, 'empty-noerror');
      await fs.mkdir(emptyDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(emptyDir);

      try {
        const config = await loadConfig({ globalDir: path.join(emptyDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
        expect(config.loadError).toBeUndefined();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should prefer local config over global config', async () => {
      // Local config
      const localYaml = `
llm:
  providers:
    - name: openai
      apiKey: sk-local
      models:
        - modelId: gpt-4
`;
      await fs.writeFile(path.join(testDir, 'wrangler.yaml'), localYaml, 'utf-8');

      // Global config (different values)
      const globalYaml = `
llm:
  providers:
    - name: anthropic
      apiKey: sk-global
      models:
        - modelId: claude-3
`;
      await fs.writeFile(path.join(globalDir, 'config.yaml'), globalYaml, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        // Local config should take priority
        expect(config.llm?.providers?.[0]?.apiKey).toBe('sk-local');
        expect(config.llm?.providers?.[0]?.name).toBe('openai');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return default model when not specified', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      apiKey: sk-test-key
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.providers?.[0]?.models?.[0]?.modelId).toBe('gpt-4o');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return baseUrl when specified', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      apiKey: sk-test-key
      baseUrl: "https://custom.api.com/v1"
      models:
        - modelId: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.providers?.[0]?.baseUrl).toBe('https://custom.api.com/v1');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should read provider and model concurrency options', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      apiKey: sk-test-key
      maxConcurrency: 10
      models:
        - modelId: gpt-4
          maxConcurrency: 4
          contextWindow: 8192
          maxTokens: 2048
          reasoning: true
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        const provider = config.llm?.providers?.[0];
        expect(provider?.maxConcurrency).toBe(10);
        const model = provider?.models?.[0];
        expect(model?.maxConcurrency).toBe(4);
        expect(model?.contextWindow).toBe(8192);
        expect(model?.maxTokens).toBe(2048);
        expect(model?.reasoning).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should read maxSteps from YAML', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      apiKey: sk-test-key
      models:
        - modelId: gpt-4
maxSteps: 50
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.maxSteps).toBe(50);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should read requestTimeout from YAML', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      apiKey: sk-test-key
      models:
        - modelId: gpt-4
requestTimeout: 30000
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.requestTimeout).toBe(30000);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return undefined for optional fields when not specified', async () => {
      const yamlContent = `
llm:
  providers:
    - name: openai
      apiKey: sk-test-key
      models:
        - modelId: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.providers?.[0]?.baseUrl).toBeUndefined();
        expect(config.llm?.providers?.[0]?.maxConcurrency).toBeUndefined();
        expect(config.maxSteps).toBeUndefined();
        expect(config.requestTimeout).toBe(1800000);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // getGlobalConfigPath
  // ---------------------------------------------------------------------------

  describe('getGlobalConfigPath', () => {
    it('should return path inside globalDir when provided', () => {
      const result = getGlobalConfigPath('/custom/global');
      expect(result).toBe(path.join('/custom/global', 'config.yaml'));
    });

    it('should return path inside default CONFIG_DIR when globalDir omitted', () => {
      const result = getGlobalConfigPath();
      expect(result).toBe(path.join(os.homedir(), '.agentskillmania', 'wrangler', 'config.yaml'));
    });
  });

  // ---------------------------------------------------------------------------
  // loadConfig error handling
  // ---------------------------------------------------------------------------

  describe('loadConfig error handling', () => {
    it('should return hasValidConfig=false for malformed YAML', async () => {
      // Write invalid YAML (unclosed quote)
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(
        localConfig,
        'llm:\n  providers:\n    - name: openai\n      apiKey: "unclosed',
        'utf-8'
      );

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false when config file path is unreadable', async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: '/dev/null/impossible' });
        expect(config.hasValidConfig).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should fallback to real CONFIG_DIR when no globalDir provided', async () => {
      // This tests the globalDir ?? CONFIG_DIR branch in findConfigPath
      // Use an empty directory so no local config exists
      const emptyDir = path.join(testDir, 'noconfig');
      await fs.mkdir(emptyDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(emptyDir);

      try {
        // No globalDir — falls back to ~/.agentskillmania/wrangler/
        const config = await loadConfig();
        expect(config.configPath).toBe(
          path.join(os.homedir(), '.agentskillmania', 'wrangler', 'config.yaml')
        );
        expect(typeof config.hasValidConfig).toBe('boolean');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // saveSetup
  // ---------------------------------------------------------------------------

  describe('saveSetup', () => {
    it('should write provider, apiKey, and model to config', async () => {
      const setupDir = path.join(testDir, 'setup');
      await fs.mkdir(setupDir, { recursive: true });

      await saveSetup(
        { provider: 'anthropic', apiKey: 'sk-ant-xyz', model: 'claude-3.5' },
        { globalDir: setupDir }
      );

      const content = await fs.readFile(path.join(setupDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('anthropic');
      expect(content).toContain('sk-ant-xyz');
      expect(content).toContain('claude-3.5');
    });

    it('should create directory if it does not exist', async () => {
      const deepDir = path.join(testDir, 'deep', 'nested', 'dir');

      await saveSetup(
        { provider: 'openai', apiKey: 'sk-new', model: 'gpt-4o' },
        { globalDir: deepDir }
      );

      const content = await fs.readFile(path.join(deepDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('openai');
      expect(content).toContain('sk-new');
    });

    it('should produce a loadable valid config', async () => {
      await saveSetup(
        { provider: 'openai', apiKey: 'sk-setup-key', model: 'gpt-4o' },
        { globalDir }
      );

      // Use isolated directory to avoid local config interference
      const noLocalDir = path.join(testDir, 'nolocal3');
      await fs.mkdir(noLocalDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(noLocalDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.providers?.[0]?.name).toBe('openai');
        expect(config.llm?.providers?.[0]?.apiKey).toBe('sk-setup-key');
        expect(config.llm?.providers?.[0]?.models?.[0]?.modelId).toBe('gpt-4o');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
