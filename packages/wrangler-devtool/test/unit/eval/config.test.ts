import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadEvalLlmConfig } from '../../../src/eval/config.js';

describe('loadEvalLlmConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'eval-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads from projectDir/wrangler.yaml', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\n`,
      'utf-8'
    );

    const config = await loadEvalLlmConfig(tempDir);

    expect(config.llm.providers).toHaveLength(1);
    expect(config.llm.providers[0].name).toBe('openai');
  });

  it('loads from projectDir/eval-config.yaml as fallback', async () => {
    writeFileSync(
      join(tempDir, 'eval-config.yaml'),
      `llm:\n  providers:\n    - name: anthropic\n      apiKey: sk-ant\n      models:\n        - modelId: claude-3\n`,
      'utf-8'
    );

    const config = await loadEvalLlmConfig(tempDir);

    expect(config.llm.providers[0].name).toBe('anthropic');
  });

  it('prefers wrangler.yaml over eval-config.yaml', async () => {
    writeFileSync(
      join(tempDir, 'wrangler.yaml'),
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-1\n      models:\n        - modelId: gpt-4o\n`,
      'utf-8'
    );
    writeFileSync(
      join(tempDir, 'eval-config.yaml'),
      `llm:\n  providers:\n    - name: anthropic\n      apiKey: sk-2\n      models:\n        - modelId: claude-3\n`,
      'utf-8'
    );

    const config = await loadEvalLlmConfig(tempDir);

    expect(config.llm.providers[0].name).toBe('openai');
  });

  it('throws when no config found in any location', async () => {
    await expect(
      loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir })
    ).rejects.toThrow('No LLM config');
  });

  it('skips files without llm.providers section', async () => {
    writeFileSync(join(tempDir, 'wrangler.yaml'), `server:\n  port: 3000\n`, 'utf-8');

    await expect(
      loadEvalLlmConfig({ projectDir: tempDir, globalDir: tempDir })
    ).rejects.toThrow('No LLM config');
  });
});
