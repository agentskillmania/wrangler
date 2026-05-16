import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentCommand } from '../../../../src/cli/commands/agent.js';
import { skillCommand } from '../../../../src/cli/commands/skill.js';
import { crewCommand } from '../../../../src/cli/commands/crew.js';
import { ExitCode } from '../../../../src/cli/options.js';

describe('create commands', () => {
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

  it('agent create should generate AGENT.md', async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const code = await agentCommand.subcommands!.create.handler!(['my-agent'], {});
      expect(code).toBe(ExitCode.Success);
      const content = readFileSync(join(tempDir, 'AGENT.md'), 'utf-8');
      expect(content).toContain('name: my-agent');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('skill create should generate skills/*.md', async () => {
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const code = await skillCommand.subcommands!.create.handler!(['my-skill'], {});
      expect(code).toBe(ExitCode.Success);
      const content = readFileSync(join(tempDir, 'skills', 'my-skill.md'), 'utf-8');
      expect(content).toContain('name: my-skill');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('crew create should generate CREW.md', async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      const code = await crewCommand.subcommands!.create.handler!(['my-crew'], {});
      expect(code).toBe(ExitCode.Success);
      const content = readFileSync(join(tempDir, 'CREW.md'), 'utf-8');
      expect(content).toContain('name: my-crew');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should reject missing name', async () => {
    await expect(agentCommand.subcommands!.create.handler!([], {})).rejects.toThrow();
  });

  it('should reject duplicate files', async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    try {
      await agentCommand.subcommands!.create.handler!(['dup'], {});
      await expect(agentCommand.subcommands!.create.handler!(['dup'], {})).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should reject missing skill name directly', async () => {
    await expect(skillCommand.subcommands!.create.handler!([], {})).rejects.toThrow();
  });

  it('should reject missing crew name directly', async () => {
    await expect(crewCommand.subcommands!.create.handler!([], {})).rejects.toThrow();
  });
});
