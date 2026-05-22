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
    expect(config.llm.model).toBe('deepseek-chat');
  });

  it('reads existing config and merges with defaults', async () => {
    await writeFile(
      join(tempDir, 'config.yaml'),
      'llm:\n  model: gpt-4o\n  baseUrl: http://example.com\n  apiKey: sk-test\nserver:\n  port: 4200\n'
    );

    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    const config = manager.get();
    expect(config.llm.model).toBe('gpt-4o');
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

  it('getConfigFile reads arbitrary config file content', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    await writeFile(join(tempDir, 'extra.yaml'), 'foo: bar\n');
    const content = await manager.getConfigFile(join(tempDir, 'extra.yaml'));
    expect(content).toContain('foo: bar');
  });

  it('setConfigFile writes content to arbitrary config file', async () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    await manager.init();

    await manager.setConfigFile(join(tempDir, 'extra.yaml'), 'baz: qux\n');
    const content = await readFile(join(tempDir, 'extra.yaml'), 'utf-8');
    expect(content).toContain('baz: qux');
  });

  it('get() throws before init()', () => {
    const manager = new ConfigManager(join(tempDir, 'config.yaml'));
    expect(() => manager.get()).toThrow('not initialized');
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
});
