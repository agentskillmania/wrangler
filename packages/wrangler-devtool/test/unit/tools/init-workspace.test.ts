import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace } from '../../../src/tools/init-workspace.js';
import { CliError } from '../../../src/cli/options.js';

describe('initWorkspace', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create agent workspace', async () => {
    const dir = join(tempDir, 'agent-workspace');
    await initWorkspace(dir, { mode: 'agent' });

    const entries = readdirSync(dir);
    expect(entries).toContain('AGENT.md');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');

    const agentMd = readFileSync(join(dir, 'AGENT.md'), 'utf-8');
    expect(agentMd).toContain('name:');
    expect(agentMd).toContain('description:');
  });

  it('should create crew workspace', async () => {
    const dir = join(tempDir, 'crew-workspace');
    await initWorkspace(dir, { mode: 'crew' });

    const entries = readdirSync(dir);
    expect(entries).toContain('CREW.md');
    expect(entries).toContain('agents');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');
  });

  it('should create bare workspace', async () => {
    const dir = join(tempDir, 'bare-workspace');
    await initWorkspace(dir, { mode: 'bare' });

    const entries = readdirSync(dir);
    expect(entries).not.toContain('AGENT.md');
    expect(entries).not.toContain('CREW.md');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');
  });

  it('should reject non-empty directory', async () => {
    const dir = join(tempDir, 'non-empty');
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'existing.txt'), 'hello', 'utf-8');

    await expect(initWorkspace(dir, { mode: 'agent' })).rejects.toThrow(CliError);
  });

  it('should use directory name as default name', async () => {
    const dir = join(tempDir, 'my-agent');
    await initWorkspace(dir, { mode: 'agent' });

    const content = readFileSync(join(dir, 'AGENT.md'), 'utf-8');
    expect(content).toContain('name: my-agent');
  });

  it('should create missing directories', async () => {
    const dir = join(tempDir, 'deeply', 'nested', 'workspace');
    await initWorkspace(dir, { mode: 'bare' });

    expect(readdirSync(dir)).toContain('skills');
  });
});
