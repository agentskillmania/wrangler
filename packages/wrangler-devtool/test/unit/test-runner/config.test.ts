/**
 * Unit tests for the test-runner's internal config/LLM helpers.
 * These were inlined from the deleted top-level config.ts/llm.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadConfig, createLLMClient } from '../../../src/test-runner/config.js';

describe('test-runner config helpers', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tr-config-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadConfig', () => {
    it('returns config when wrangler.yaml has valid LLM config', async () => {
      writeFileSync(
        join(tempDir, 'wrangler.yaml'),
        `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\n`,
        'utf-8'
      );

      const config = await loadConfig({ skipGlobal: true });
      expect(config).not.toBeNull();
      expect(config!.llm.providers).toHaveLength(1);
      expect(config!.llm.providers[0].name).toBe('openai');
      expect(config!.llm.providers[0].apiKey).toBe('sk-test');
    });

    it('returns null when wrangler.yaml does not exist', async () => {
      const config = await loadConfig({ skipGlobal: true });
      expect(config).toBeNull();
    });

    it('returns null when wrangler.yaml has no llm key', async () => {
      writeFileSync(join(tempDir, 'wrangler.yaml'), `server:\n  port: 3000\n`, 'utf-8');
      const config = await loadConfig({ skipGlobal: true });
      expect(config).toBeNull();
    });

    it('returns null when providers array is empty', async () => {
      writeFileSync(
        join(tempDir, 'wrangler.yaml'),
        `llm:\n  providers: []\n`,
        'utf-8'
      );
      const config = await loadConfig({ skipGlobal: true });
      expect(config).toBeNull();
    });

    it('returns null when provider is missing apiKey', async () => {
      writeFileSync(
        join(tempDir, 'wrangler.yaml'),
        `llm:\n  providers:\n    - name: openai\n      models:\n        - modelId: gpt-4o\n`,
        'utf-8'
      );
      const config = await loadConfig({ skipGlobal: true });
      expect(config).toBeNull();
    });

    it('returns null when provider is missing models', async () => {
      writeFileSync(
        join(tempDir, 'wrangler.yaml'),
        `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n`,
        'utf-8'
      );
      const config = await loadConfig({ skipGlobal: true });
      expect(config).toBeNull();
    });
  });

  describe('createLLMClient', () => {
    it('returns an LLMClient with call method', () => {
      const client = createLLMClient({
        providers: [{ name: 'test', apiKey: 'sk-test', models: [{ modelId: 'm' }] }],
      });
      expect(client).toBeDefined();
      expect(typeof client.call).toBe('function');
    });
  });
});
