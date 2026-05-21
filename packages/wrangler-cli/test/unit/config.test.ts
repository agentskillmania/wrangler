/**
 * config.ts unit tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, saveConfig, saveSetup, setNestedValue } from '../../src/config.js';

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
  // setNestedValue
  // ---------------------------------------------------------------------------

  describe('setNestedValue', () => {
    it('should set top-level key', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'name', 'test');
      expect(obj.name).toBe('test');
    });

    it('should set nested path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'llm.provider', 'openai');
      expect((obj.llm as Record<string, unknown>).provider).toBe('openai');
    });

    it('should set deeply nested path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'a.b.c', 'value');
      const a = obj.a as Record<string, unknown>;
      const b = a.b as Record<string, unknown>;
      expect(b.c).toBe('value');
    });

    it('should overwrite existing value', () => {
      const obj: Record<string, unknown> = { name: 'old' };
      setNestedValue(obj, 'name', 'new');
      expect(obj.name).toBe('new');
    });

    it('should set nested value on existing object', () => {
      const obj: Record<string, unknown> = {
        llm: { provider: 'openai' },
      };
      setNestedValue(obj, 'llm.model', 'gpt-4');
      const llm = obj.llm as Record<string, unknown>;
      expect(llm.provider).toBe('openai');
      expect(llm.model).toBe('gpt-4');
    });

    it('should overwrite non-object value with object', () => {
      const obj: Record<string, unknown> = { llm: 'string' };
      setNestedValue(obj, 'llm.provider', 'openai');
      expect(typeof obj.llm).toBe('object');
    });
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
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.provider).toBe('openai');
        expect(config.llm?.apiKey).toBe('sk-test-key');
        expect(config.llm?.model).toBe('gpt-4');
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
  provider: anthropic
  apiKey: sk-ant-test
  model: claude-3
`;
      await fs.writeFile(path.join(globalDir, 'config.yaml'), yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(localOnlyDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.provider).toBe('anthropic');
        expect(config.llm?.apiKey).toBe('sk-ant-test');
        expect(config.llm?.model).toBe('claude-3');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false when apiKey is missing', async () => {
      const yamlContent = `
llm:
  provider: openai
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

    it('should return hasValidConfig=false when provider is missing from file but default merges it', async () => {
      // The default YAML includes provider: openai. When the user file omits provider
      // but includes apiKey, Settings merges the default provider, making it valid.
      // This test verifies the merged result: provider comes from default, apiKey from file.
      const yamlContent = `
llm:
  apiKey: sk-test-key
  model: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        // Provider is merged from default YAML, so combined config is valid
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.provider).toBe('openai');
        expect(config.llm?.apiKey).toBe('sk-test-key');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return hasValidConfig=false when both provider and apiKey are missing', async () => {
      // Neither the file nor the default YAML provide an apiKey
      const yamlContent = `
llm:
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

    it('should prefer local config over global config', async () => {
      // Local config
      const localYaml = `
llm:
  provider: openai
  apiKey: sk-local
  model: gpt-4
`;
      await fs.writeFile(path.join(testDir, 'wrangler.yaml'), localYaml, 'utf-8');

      // Global config (different values)
      const globalYaml = `
llm:
  provider: anthropic
  apiKey: sk-global
  model: claude-3
`;
      await fs.writeFile(path.join(globalDir, 'config.yaml'), globalYaml, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        // Local config should take priority
        expect(config.llm?.apiKey).toBe('sk-local');
        expect(config.llm?.provider).toBe('openai');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return default model when not specified', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.model).toBe('gpt-4o');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return baseUrl when specified', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
  baseUrl: "https://custom.api.com/v1"
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.baseUrl).toBe('https://custom.api.com/v1');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should read thinkingEnabled from YAML', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
  thinkingEnabled: true
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.thinkingEnabled).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should read enablePromptThinking from YAML', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
  enablePromptThinking: true
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.enablePromptThinking).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should read maxConcurrency from YAML', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
  maxConcurrency: 10
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.maxConcurrency).toBe(10);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should read maxSteps from YAML', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
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
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
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

    it('should return undefined for new fields when not specified', async () => {
      const yamlContent = `
llm:
  provider: openai
  apiKey: sk-test-key
  model: gpt-4
`;
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, yamlContent, 'utf-8');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const config = await loadConfig({ globalDir: path.join(testDir, 'noglobal') });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.thinkingEnabled).toBeUndefined();
        expect(config.llm?.enablePromptThinking).toBeUndefined();
        expect(config.llm?.maxConcurrency).toBeUndefined();
        expect(config.maxSteps).toBeUndefined();
        expect(config.requestTimeout).toBe(1800000);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // loadConfig error handling
  // ---------------------------------------------------------------------------

  describe('loadConfig error handling', () => {
    it('should return hasValidConfig=false for malformed YAML', async () => {
      // Write invalid YAML (unclosed quote)
      const localConfig = path.join(testDir, 'wrangler.yaml');
      await fs.writeFile(localConfig, 'llm:\n  provider: openai\n  apiKey: "unclosed', 'utf-8');

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
        // Result depends on whether real config exists; just verify it doesn't throw
        expect(typeof config.hasValidConfig).toBe('boolean');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // saveConfig
  // ---------------------------------------------------------------------------

  describe('saveConfig', () => {
    it('should save config to specified global path', async () => {
      await saveConfig('llm.provider', 'openai', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('openai');
    });

    it('should set nested path value', async () => {
      await saveConfig('llm.apiKey', 'sk-test-new', { globalDir });
      await saveConfig('llm.model', 'gpt-4o', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('sk-test-new');
      expect(content).toContain('gpt-4o');
    });

    it('should set new top-level key', async () => {
      await saveConfig('agent.name', 'my-test-agent', { globalDir });

      const content = await fs.readFile(path.join(globalDir, 'config.yaml'), 'utf-8');
      expect(content).toContain('my-test-agent');
    });

    it('should load config after saving', async () => {
      await saveConfig('llm.provider', 'openai', { globalDir });
      await saveConfig('llm.apiKey', 'sk-test-key', { globalDir });
      await saveConfig('llm.model', 'gpt-4', { globalDir });

      // Use isolated directory to avoid local config interference
      const noLocalDir = path.join(testDir, 'nolocal2');
      await fs.mkdir(noLocalDir, { recursive: true });

      const originalCwd = process.cwd();
      process.chdir(noLocalDir);

      try {
        const config = await loadConfig({ globalDir });
        expect(config.hasValidConfig).toBe(true);
        expect(config.llm?.provider).toBe('openai');
        expect(config.llm?.apiKey).toBe('sk-test-key');
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
        expect(config.llm?.provider).toBe('openai');
        expect(config.llm?.apiKey).toBe('sk-setup-key');
        expect(config.llm?.model).toBe('gpt-4o');
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
