import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from '../../../../src/cli/commands/init.js';
import { ExitCode } from '../../../../src/cli/options.js';

describe('init command', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
  });

  it('should initialize agent workspace', async () => {
    const dir = join(tempDir, 'agent-ws');
    const code = await initCommand.handler!([dir], { type: 'agent' });
    expect(code).toBe(ExitCode.Success);

    const entries = readdirSync(dir);
    expect(entries).toContain('AGENT.md');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');
  });

  it('should initialize crew workspace', async () => {
    const dir = join(tempDir, 'crew-ws');
    const code = await initCommand.handler!([dir], { type: 'crew' });
    expect(code).toBe(ExitCode.Success);

    const entries = readdirSync(dir);
    expect(entries).toContain('CREW.md');
    expect(entries).toContain('agents');
    expect(entries).toContain('skills');
    expect(entries).toContain('test');
  });

  it('should use cwd when directory is omitted', async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const code = await initCommand.handler!([], { type: 'agent' });
      expect(code).toBe(ExitCode.Success);
      expect(existsSync(join(tempDir, 'AGENT.md'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should reject invalid type', async () => {
    const dir = join(tempDir, 'bad-ws');
    await expect(initCommand.handler!([dir], { type: 'invalid' })).rejects.toThrow();
  });

  it('should reject non-empty directory', async () => {
    const dir = join(tempDir, 'non-empty');
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'existing.txt'), 'hello', 'utf-8');

    await expect(initCommand.handler!([dir], { type: 'agent' })).rejects.toThrow();
  });
});
