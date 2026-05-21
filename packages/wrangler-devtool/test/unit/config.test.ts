import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, requireLLMConfig } from '../../src/config.js';

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cfg-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads maxSteps and requestTimeout from config', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n  baseUrl: https://api.example.com\n  thinkingEnabled: true\n  enablePromptThinking: true\n  maxConcurrency: 8\nmaxSteps: 100\nrequestTimeout: 300000\n`
    );

    const config = await loadConfig(tempDir, [configPath]);

    expect(config).not.toBeNull();
    expect(config!.llm!.provider).toBe('openai');
    expect(config!.llm!.baseUrl).toBe('https://api.example.com');
    expect(config!.llm!.thinkingEnabled).toBe(true);
    expect(config!.llm!.enablePromptThinking).toBe(true);
    expect(config!.llm!.maxConcurrency).toBe(8);
    expect(config!.maxSteps).toBe(100);
    expect(config!.requestTimeout).toBe(300000);
  });

  it('returns defaults for optional fields', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n`
    );

    const config = await loadConfig(tempDir, [configPath]);

    expect(config!.maxSteps).toBeUndefined();
    expect(config!.requestTimeout).toBeUndefined();
    expect(config!.llm!.baseUrl).toBeUndefined();
    expect(config!.llm!.thinkingEnabled).toBeUndefined();
    expect(config!.llm!.maxConcurrency).toBeUndefined();
  });

  it('parses numeric strings for maxSteps and requestTimeout', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\nmaxSteps: "200"\nrequestTimeout: "60000"\n`
    );

    const config = await loadConfig(tempDir, [configPath]);
    expect(config!.maxSteps).toBe(200);
    expect(config!.requestTimeout).toBe(60000);
  });

  it('ignores non-numeric strings for maxSteps and requestTimeout', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\nmaxSteps: not-a-number\nrequestTimeout: also-not\n`
    );

    const config = await loadConfig(tempDir, [configPath]);
    expect(config!.maxSteps).toBeUndefined();
    expect(config!.requestTimeout).toBeUndefined();
  });
});

describe('requireLLMConfig', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cfg-req-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns llm config when valid', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n`
    );

    const llm = await requireLLMConfig(tempDir);
    expect(llm.provider).toBe('openai');
    expect(llm.apiKey).toBe('sk-test');
    expect(llm.model).toBe('gpt-4o');
  });
});
