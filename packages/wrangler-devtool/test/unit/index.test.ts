import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_TIMEOUT = 60000;

describe('@agentskillmania/wrangler-devtool', () => {
  it(
    'exports scaffolding tools and BUILTIN_SKILLS_DIR',
    async () => {
      const mod = await import('../../src/index.js');

      // Scaffolding
      expect(mod.initProject).toBeTypeOf('function');
      expect(mod.createTemplate).toBeTypeOf('function');
      expect(mod.applyChanges).toBeTypeOf('function');
      // CLI basics
      expect(mod.CliError).toBeTypeOf('function');
      expect(mod.ExitCode).toBeDefined();
      // Skills directory
      expect(mod.BUILTIN_SKILLS_DIR).toBeTypeOf('string');
      expect(mod.BUILTIN_SKILLS_DIR.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );

  it(
    'does NOT export DevTool or agent functions (removed in refactoring)',
    async () => {
      const mod = await import('../../src/index.js' ) as Record<string, unknown>;
      expect(mod.DevTool).toBeUndefined();
      expect(mod.runAgentArchitect).toBeUndefined();
      expect(mod.runReviewer).toBeUndefined();
      expect(mod.loadConfig).toBeUndefined();
    },
    TEST_TIMEOUT
  );

  it(
    'initProject creates expected directory structure',
    async () => {
      const { initProject } = await import('../../src/index.js');
      const dir = mkdtempSync(join(tmpdir(), 'init-test-'));

      await initProject(dir, { type: 'agent' });

      // Verify expected files/directories exist
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(dir, 'AGENT.md'))).toBe(true);
      expect(existsSync(join(dir, 'mcp.json'))).toBe(true);
      expect(existsSync(join(dir, 'mcp.json.example'))).toBe(true);
      expect(existsSync(join(dir, 'skills'))).toBe(true);
      expect(existsSync(join(dir, 'test'))).toBe(true);
      expect(existsSync(join(dir, '.git'))).toBe(true);

      rmSync(dir, { recursive: true, force: true });
    },
    TEST_TIMEOUT
  );

  it(
    'createTemplate generates correct file content',
    async () => {
      const { createTemplate } = await import('../../src/index.js');
      const dir = mkdtempSync(join(tmpdir(), 'template-test-'));

      const filePath = await createTemplate('agent', 'test-agent', dir);
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');

      expect(content).toMatch(/^---\nname: test-agent\n/);
      expect(content).toContain('description: A new agent');

      rmSync(dir, { recursive: true, force: true });
    },
    TEST_TIMEOUT
  );

  it('CliError is a proper Error subclass', async () => {
    const { CliError } = await import('../../src/index.js');
    const err = new CliError('test message', 'TEST_CODE', 42);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.exitCode).toBe(42);
  });
});
