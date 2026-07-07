/**
 * Unit tests for the merged `create` command (replaces agent/crew/skill create).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const createTemplateMock = vi.hoisted(() => ({ createTemplate: vi.fn() }));
vi.mock('../../../../src/tools/create-template.js', () => ({
  createTemplate: createTemplateMock.createTemplate,
}));

import { createCommand } from '../../../../src/cli/commands/create.js';
import { CliError, ExitCode } from '../../../../src/cli/options.js';

describe('create command', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'create-cmd-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    createTemplateMock.createTemplate.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates an agent template and outputs JSON', async () => {
    const mockPath = join(tempDir, 'AGENT.md');
    createTemplateMock.createTemplate.mockResolvedValue(mockPath);

    const exitCode = await createCommand.handler!(['agent', 'my-agent'], {} as never);

    expect(exitCode).toBe(ExitCode.Success);
    expect(createTemplateMock.createTemplate).toHaveBeenCalledWith(
      'agent',
      'my-agent',
      process.cwd()
    );
  });

  it('creates a crew template', async () => {
    createTemplateMock.createTemplate.mockResolvedValue(join(tempDir, 'CREW.md'));
    await createCommand.handler!(['crew', 'my-crew'], {} as never);
    expect(createTemplateMock.createTemplate).toHaveBeenCalledWith(
      'crew',
      'my-crew',
      process.cwd()
    );
  });

  it('creates a skill template', async () => {
    createTemplateMock.createTemplate.mockResolvedValue(join(tempDir, 'SKILL.md'));
    await createCommand.handler!(['skill', 'my-skill'], {} as never);
    expect(createTemplateMock.createTemplate).toHaveBeenCalledWith(
      'skill',
      'my-skill',
      process.cwd()
    );
  });

  it('throws CliError when type is missing', async () => {
    await expect(createCommand.handler!([], {} as never)).rejects.toThrow(CliError);
    try {
      await createCommand.handler!([], {} as never);
    } catch (e) {
      expect(e as CliError).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe('MISSING_TYPE');
    }
  });

  it('throws CliError for invalid type', async () => {
    await expect(createCommand.handler!(['invalid', 'name'], {} as never)).rejects.toThrow(
      'Invalid type'
    );
    try {
      await createCommand.handler!(['invalid', 'name'], {} as never);
    } catch (e) {
      expect((e as CliError).code).toBe('INVALID_TYPE');
    }
  });

  it('throws CliError when name is missing', async () => {
    await expect(createCommand.handler!(['agent'], {} as never)).rejects.toThrow(
      'Name is required'
    );
  });
});
