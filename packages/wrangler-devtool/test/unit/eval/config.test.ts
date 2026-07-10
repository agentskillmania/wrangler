import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadEvalLlmConfig } from '../../../src/eval/config.js';

describe('loadEvalLlmConfig', () => {
  let tempDir: string;
  let savedKey: string | undefined;
  let savedBaseUrl: string | undefined;
  let savedProvider: string | undefined;
  let savedModel: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-config-'));
    // Save and clear env vars so YAML tests aren't affected
    savedKey = process.env.OPENAI_API_KEY;
    savedBaseUrl = process.env.OPENAI_BASE_URL;
    savedProvider = process.env.PROVIDER;
    savedModel = process.env.MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.PROVIDER;
    delete process.env.MODEL;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Restore env vars
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    if (savedBaseUrl !== undefined) process.env.OPENAI_BASE_URL = savedBaseUrl;
    if (savedProvider !== undefined) process.env.PROVIDER = savedProvider;
    if (savedModel !== undefined) process.env.MODEL = savedModel;
  });

  // ── Environment variables (priority 0) ─────────────────

  it('loads from OPENAI_API_KEY env var', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.MODEL = 'gpt-4o';

    const config = await loadEvalLlmConfig({ projectDir: tempDir });

    expect(config.llm.providers).toHaveLength(1);
    expect(config.llm.providers[0].apiKey).toBe('sk-test');
    expect(config.llm.providers[0].models[0].modelId).toBe('gpt-4o');
  });

  it('includes OPENAI_BASE_URL when set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1';

    const config = await loadEvalLlmConfig({ projectDir: tempDir });

    expect(config.llm.providers[0].baseUrl).toBe('https://api.example.com/v1');
  });

  it('respects PROVIDER env var', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.PROVIDER = 'bigmodel';

    const config = await loadEvalLlmConfig({ projectDir: tempDir });

    expect(config.llm.providers[0].name).toBe('bigmodel');
  });

  // ── YAML fallback ──────────────────────────────────────

  it('loads from projectDir/wrangler.yaml when no env var', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-yaml\n      models:\n        - modelId: gpt-4o\n`,
      'utf-8'
    );

    const config = await loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir });

    expect(config.llm.providers[0].apiKey).toBe('sk-yaml');
  });

  it('loads from eval-config.yaml as fallback', async () => {
    writeFileSync(
      join(tempDir, 'eval-config.yaml'),
      `llm:\n  providers:\n    - name: anthropic\n      apiKey: sk-ant\n      models:\n        - modelId: claude-3\n`,
      'utf-8'
    );

    const config = await loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir });

    expect(config.llm.providers[0].name).toBe('anthropic');
  });

  it('throws when no config found anywhere', async () => {
    await expect(
      loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir })
    ).rejects.toThrow('No LLM config');
  });

  it('skips YAML files without llm.providers section', async () => {
    writeFileSync(join(tempDir, 'wrangler.yaml'), `server:\n  port: 3000\n`, 'utf-8');

    await expect(
      loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir })
    ).rejects.toThrow('No LLM config');
  });
});
