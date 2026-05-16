import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTemplate } from '../../../src/tools/create-template.js';
import { CliError } from '../../../src/cli/options.js';

describe('createTemplate', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create agent template', async () => {
    const path = await createTemplate('agent', 'test-agent', tempDir);
    expect(path).toBe(join(tempDir, 'AGENT.md'));

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('name: test-agent');
    expect(content).toContain('description:');
  });

  it('should create skill template', async () => {
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    const path = await createTemplate('skill', 'test-skill', tempDir);
    expect(path).toBe(join(tempDir, 'skills', 'test-skill.md'));

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('name: test-skill');
  });

  it('should create crew template', async () => {
    const path = await createTemplate('crew', 'test-crew', tempDir);
    expect(path).toBe(join(tempDir, 'CREW.md'));

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('name: test-crew');
  });

  it('should create session template', async () => {
    const path = await createTemplate('session', 'test-session', tempDir);
    expect(path).toBe(join(tempDir, '.vibe', 'test-session.md'));
  });

  it('should reject duplicate files', async () => {
    await createTemplate('agent', 'test-agent', tempDir);
    await expect(createTemplate('agent', 'test-agent', tempDir)).rejects.toThrow(CliError);
  });

  it('should create skills directory if missing', async () => {
    const path = await createTemplate('skill', 'auto-dir', tempDir);
    expect(path).toBe(join(tempDir, 'skills', 'auto-dir.md'));
  });

  it('should reject unknown template type', async () => {
    await expect(createTemplate('unknown' as any, 'name', tempDir)).rejects.toThrow(CliError);
  });
});
