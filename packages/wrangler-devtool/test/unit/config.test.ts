import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/nonexistent-home-for-testing'),
  tmpdir: vi.fn(() => '/tmp'),
}));

import { loadConfig, requireLLMConfig } from '../../src/config.js';

describe('loadConfig', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync('/tmp/wrangler-config-test-');
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return null when no config exists', async () => {
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('should load config from wrangler.yaml in cwd', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n`,
      'utf-8'
    );
    const config = await loadConfig();
    expect(config).not.toBeNull();
    expect(config?.llm?.provider).toBe('openai');
    expect(config?.llm?.apiKey).toBe('sk-test');
    expect(config?.llm?.model).toBe('gpt-4o');
  });

  it('should load config with baseUrl', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n  baseUrl: https://custom.example.com\n`,
      'utf-8'
    );
    const config = await loadConfig();
    expect(config?.llm?.baseUrl).toBe('https://custom.example.com');
  });

  it('should load config from explicit cwd', async () => {
    const otherDir = mkdtempSync('/tmp/wrangler-config-other-');
    writeFileSync(
      join(otherDir, 'wrangler.yaml'),
      `llm:\n  provider: anthropic\n  apiKey: sk-ant\n  model: claude-3\n`,
      'utf-8'
    );
    const config = await loadConfig(otherDir);
    expect(config?.llm?.provider).toBe('anthropic');
    rmSync(otherDir, { recursive: true, force: true });
  });

  it('should reject invalid config missing apiKey', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  provider: openai\n  model: gpt-4o\n`,
      'utf-8'
    );
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('should reject invalid config missing model', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  provider: openai\n  apiKey: sk-test\n`,
      'utf-8'
    );
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('should reject invalid config missing provider', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  apiKey: sk-test\n  model: gpt-4o\n`,
      'utf-8'
    );
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('should reject empty string values', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  provider: ""\n  apiKey: sk-test\n  model: gpt-4o\n`,
      'utf-8'
    );
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('should reject invalid YAML', async () => {
    writeFileSync(join(tempDir, 'wrangler.yaml'), `llm: { invalid`, 'utf-8');
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('should reject config without llm key', async () => {
    writeFileSync(join(tempDir, 'wrangler.yaml'), `other:\n  key: value\n`, 'utf-8');
    const config = await loadConfig();
    expect(config).toBeNull();
  });

  it('should accept extraPaths parameter', async () => {
    const extraDir = mkdtempSync('/tmp/wrangler-config-extra-');
    writeFileSync(
      join(extraDir, 'extra.yaml'),
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n`,
      'utf-8'
    );
    const config = await loadConfig(undefined, [join(extraDir, 'extra.yaml')]);
    expect(config?.llm?.provider).toBe('openai');
    rmSync(extraDir, { recursive: true, force: true });
  });
});

describe('requireLLMConfig', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync('/tmp/wrangler-config-test-');
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return config when valid', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n`,
      'utf-8'
    );
    const config = await requireLLMConfig();
    expect(config.provider).toBe('openai');
  });

  it('should throw when no config exists', async () => {
    await expect(requireLLMConfig()).rejects.toThrow('No valid LLM configuration');
  });
});
