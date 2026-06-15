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
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: https://api.example.com\n      maxConcurrency: 8\n      models:\n        - modelId: gpt-4o\nmaxSteps: 100\nrequestTimeout: 300000\n`
    );

    const config = await loadConfig(tempDir, { extraPaths: [configPath] });

    expect(config).not.toBeNull();
    expect(config!.llm!.providers[0].name).toBe('openai');
    expect(config!.llm!.providers[0].baseUrl).toBe('https://api.example.com');
    expect(config!.llm!.providers[0].maxConcurrency).toBe(8);
    expect(config!.llm!.providers[0].models[0].modelId).toBe('gpt-4o');
    expect(config!.maxSteps).toBe(100);
    expect(config!.requestTimeout).toBe(300000);
  });

  it('returns defaults for optional fields', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\n`
    );

    const config = await loadConfig(tempDir, { extraPaths: [configPath] });

    expect(config!.maxSteps).toBeUndefined();
    expect(config!.requestTimeout).toBeUndefined();
    expect(config!.llm!.providers[0].baseUrl).toBeUndefined();
    expect(config!.llm!.providers[0].maxConcurrency).toBeUndefined();
    expect(config!.llm!.providers[0].models[0].maxConcurrency).toBeUndefined();
  });

  it('parses numeric strings for maxSteps and requestTimeout', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\nmaxSteps: "200"\nrequestTimeout: "60000"\n`
    );

    const config = await loadConfig(tempDir, { extraPaths: [configPath] });
    expect(config!.maxSteps).toBe(200);
    expect(config!.requestTimeout).toBe(60000);
  });

  it('ignores non-numeric strings for maxSteps and requestTimeout', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\nmaxSteps: not-a-number\nrequestTimeout: also-not\n`
    );

    const config = await loadConfig(tempDir, { extraPaths: [configPath] });
    expect(config!.maxSteps).toBeUndefined();
    expect(config!.requestTimeout).toBeUndefined();
  });

  it('returns null when no config file exists', async () => {
    const config = await loadConfig(tempDir, { skipGlobal: true });
    expect(config).toBeNull();
  });

  it('returns null when YAML is malformed', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(configPath, `: [invalid yaml`);

    const config = await loadConfig(tempDir, { extraPaths: [configPath], skipGlobal: true });
    expect(config).toBeNull();
  });

  it('returns null when llm section is missing', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(configPath, `maxSteps: 100\n`);

    const config = await loadConfig(tempDir, { extraPaths: [configPath], skipGlobal: true });
    expect(config).toBeNull();
  });

  it('returns null when llm config is invalid — missing model', async () => {
    const configPath = join(tempDir, 'wrangler.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models: []\n`
    );

    const config = await loadConfig(tempDir, { extraPaths: [configPath], skipGlobal: true });
    expect(config).toBeNull();
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
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\n`
    );

    const llm = await requireLLMConfig(tempDir);
    expect(llm.providers[0].name).toBe('openai');
    expect(llm.providers[0].apiKey).toBe('sk-test');
    expect(llm.providers[0].models[0].modelId).toBe('gpt-4o');
  });
});
