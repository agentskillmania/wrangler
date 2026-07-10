import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadEvalLlmConfig } from '../../../src/eval/config.js';

describe('loadEvalLlmConfig', () => {
  let tempDir: string;
  let savedKey: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-config-'));
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
  });

  // ── YAML configs ───────────────────────────────────────

  it('loads from eval-config.yaml (highest YAML priority)', async () => {
    writeFileSync(
      join(tempDir, 'eval-config.yaml'),
      `llm:\n  providers:\n    - name: bigmodel\n      apiKey: sk-judge\n      models:\n        - modelId: glm-5.2\njudge:\n  model: glm-5.2\n`,
      'utf-8'
    );

    const config = await loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir });

    expect(config.llm.providers[0].name).toBe('bigmodel');
    expect(config.judgeModel).toBe('glm-5.2');
  });

  it('loads from wrangler.yaml when no eval-config.yaml', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-proj\n      models:\n        - modelId: gpt-4o\n`,
      'utf-8'
    );

    const config = await loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir });

    expect(config.llm.providers[0].apiKey).toBe('sk-proj');
    expect(config.judgeModel).toBeUndefined();
  });

  it('prefers eval-config.yaml over wrangler.yaml', async () => {
    writeFileSync(join(tempDir, 'eval-config.yaml'),
      `llm:\n  providers:\n    - name: eval\n      apiKey: sk-1\n      models: [{ modelId: m1 }]\n`, 'utf-8');
    writeFileSync(join(tempDir, 'wrangler.yaml'),
      `llm:\n  providers:\n    - name: wrangler\n      apiKey: sk-2\n      models: [{ modelId: m2 }]\n`, 'utf-8');

    const config = await loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir });

    expect(config.llm.providers[0].name).toBe('eval');
  });

  it('falls back to global config', async () => {
    const globalDir = mkdtempSync(join(tmpdir(), 'eval-global-'));
    writeFileSync(join(globalDir, 'config.yaml'),
      `llm:\n  providers:\n    - name: global\n      apiKey: sk-global\n      models: [{ modelId: gm }]\n`, 'utf-8');

    const config = await loadEvalLlmConfig({ globalDir });
    expect(config.llm.providers[0].name).toBe('global');

    rmSync(globalDir, { recursive: true, force: true });
  });

  it('skips YAML files without llm.providers', async () => {
    writeFileSync(join(tempDir, 'wrangler.yaml'), `server:\n  port: 3000\n`, 'utf-8');

    await expect(loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir })).rejects.toThrow();
  });

  // ── Environment variable fallback ──────────────────────

  it('falls back to env vars when no YAML', async () => {
    process.env.OPENAI_API_KEY = 'sk-env';
    process.env.MODEL = 'gpt-4o';
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1';
    process.env.PROVIDER = 'custom';

    const config = await loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir });

    expect(config.llm.providers[0].apiKey).toBe('sk-env');
    expect(config.llm.providers[0].name).toBe('custom');
    expect(config.llm.providers[0].baseUrl).toBe('https://api.example.com/v1');
    expect(config.llm.providers[0].models[0].modelId).toBe('gpt-4o');

    delete process.env.MODEL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.PROVIDER;
  });

  // ── No config ─────────────────────────────────────────

  it('throws when no config found anywhere', async () => {
    await expect(loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir })).rejects.toThrow();
  });
});
