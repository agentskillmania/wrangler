import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../../src/core/config-manager.js';
import type { DaemonConfig } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/types.js';

describe('ConfigManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates config file with defaults on first init', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    const content = await readFile(join(tempDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('llm');
    expect(content).toContain('server');
  });

  it('returns default config values after init', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    const config = manager.get();
    expect(config.server.port).toBe(3100);
    expect(config.llm.providers[0].models[0].modelId).toBe('deepseek-chat');
  });

  it('reads existing config and merges with defaults', async () => {
    await writeFile(
      join(tempDir, 'config.yaml'),
      'llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: http://example.com\n      models:\n        - modelId: gpt-4o\nserver:\n  port: 4200\n'
    );

    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    const config = manager.get();
    expect(config.llm.providers[0].models[0].modelId).toBe('gpt-4o');
    expect(config.llm.providers[0].apiKey).toBe('sk-test');
    expect(config.server.port).toBe(4200);
    expect(config.server.host).toBe('localhost');
  });

  it('updates a config value and persists to disk', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    await manager.update({ server: { port: 5000, host: '0.0.0.0' } });

    const config = manager.get();
    expect(config.server.port).toBe(5000);

    // Verify persisted
    const content = await readFile(join(tempDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('5000');
  });

  it('getConfigFileRaw returns the EXACT bytes currently on disk for the daemon config', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const manager = new ConfigManager(configPath);
    await manager.init();

    // Contract: returns whatever is currently in the daemon config file,
    // byte-for-byte (not a parsed/re-serialized version).
    const onDisk = await readFile(configPath, 'utf-8');
    const fromApi = await manager.getConfigFileRaw();
    expect(fromApi).toBe(onDisk);
  });

  it('setConfigFileRaw overwrites the daemon config file with the exact content', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const manager = new ConfigManager(configPath);
    await manager.init();

    const newContent =
      'llm:\n  providers:\n    - name: x\n      apiKey: y\n      models:\n        - modelId: z\nserver:\n  port: 3100\n  host: localhost\n';
    await manager.setConfigFileRaw(newContent);

    // Exact match — verifies OVERWRITE (not append/merge)
    const content = await readFile(configPath, 'utf-8');
    expect(content).toBe(newContent);
  });

  it('get() throws before init()', () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    expect(() => manager.get()).toThrow('not initialized');
  });

  it('update() throws before init()', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await expect(manager.update({ server: { port: 4000 } })).rejects.toThrow('not initialized');
  });

  it('getConfigFileRaw rejects (ENOENT) when the daemon config file does not exist', async () => {
    const manager = new ConfigManager(join(tempDir, 'no-such.yaml'));
    await expect(manager.getConfigFileRaw()).rejects.toThrow();
  });

  it('setConfigFileRaw rejects invalid YAML and leaves the file UNCHANGED', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const manager = new ConfigManager(configPath);
    await manager.init();
    const before = await readFile(configPath, 'utf-8');

    await expect(manager.setConfigFileRaw(':\n  bad: : yaml')).rejects.toThrow();

    // Side-effect contract: failed validation must not write anything
    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('setConfigFileRaw rejects non-mapping YAML root (array) and leaves the file UNCHANGED', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const manager = new ConfigManager(configPath);
    await manager.init();
    const before = await readFile(configPath, 'utf-8');

    await expect(manager.setConfigFileRaw('- a\n- b\n')).rejects.toThrow();

    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('setConfigFileRaw rejects non-mapping YAML root (scalar) and leaves the file UNCHANGED', async () => {
    const configPath = join(tempDir, 'config.yaml');
    const manager = new ConfigManager(configPath);
    await manager.init();
    const before = await readFile(configPath, 'utf-8');

    await expect(manager.setConfigFileRaw('just a string\n')).rejects.toThrow();

    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('update handles nested key creation', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    // Update a nested value that exists
    await manager.update({ server: { port: 5000 } });

    const config = manager.get();
    expect(config.server.port).toBe(5000);
  });

  it('update handles top-level key creation', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    // Set a new top-level key
    await manager.update({ newKey: 'newValue' } as Partial<DaemonConfig>);

    const config = manager.get();
    expect((config as any).newKey).toBe('newValue');
  });

  it('throws when config contains legacy flat LLM keys', async () => {
    await writeFile(
      join(tempDir, 'config.yaml'),
      'llm:\n  apiKey: sk-legacy\n  model: deepseek-chat\n'
    );

    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    expect(() => manager.get()).toThrow('deprecated flat LLM format');
  });
});
