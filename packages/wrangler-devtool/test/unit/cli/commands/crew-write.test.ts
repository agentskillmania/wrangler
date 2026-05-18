import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crewCommand } from '../../../../src/cli/commands/crew.js';
import { ExitCode } from '../../../../src/cli/options.js';
import * as crewComposerModule from '../../../../src/agents/crew-composer.js';

describe('crew write', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
    originalCwd = process.cwd();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('should create CREW.md with --apply (mocked LLM)', async () => {
    process.chdir(tempDir);
    vi.spyOn(crewComposerModule, 'runCrewComposer').mockResolvedValue({
      changes: [{ file: 'CREW.md', type: 'create', new: '---\nname: dev-team\n---\n\n# Dev Team' }],
      summary: 'Created dev team crew',
    });

    const code = await crewCommand.subcommands!.write.handler!([], {
      prompt: 'Create a dev team crew',
      apply: true,
    });

    expect(code).toBe(ExitCode.Success);
    expect(existsSync(join(tempDir, 'CREW.md'))).toBe(true);
    const content = readFileSync(join(tempDir, 'CREW.md'), 'utf-8');
    expect(content).toContain('Dev Team');
  });

  it('should default to dry-run', async () => {
    process.chdir(tempDir);
    vi.spyOn(crewComposerModule, 'runCrewComposer').mockResolvedValue({
      changes: [{ file: 'CREW.md', type: 'create', new: 'content' }],
      summary: 'Created',
    });

    const code = await crewCommand.subcommands!.write.handler!([], {
      prompt: 'Create a crew',
    });

    expect(code).toBe(ExitCode.Success);
    expect(existsSync(join(tempDir, 'CREW.md'))).toBe(false);
  });

  it('should edit existing CREW.md with --apply', async () => {
    process.chdir(tempDir);
    writeFileSync(join(tempDir, 'CREW.md'), 'old crew content', 'utf-8');

    vi.spyOn(crewComposerModule, 'runCrewComposer').mockResolvedValue({
      changes: [
        { file: 'CREW.md', type: 'edit', old: 'old crew content', new: 'new crew content' },
      ],
      summary: 'Updated',
    });

    const code = await crewCommand.subcommands!.write.handler!([], {
      prompt: 'Update crew',
      apply: true,
    });

    expect(code).toBe(ExitCode.Success);
    expect(readFileSync(join(tempDir, 'CREW.md'), 'utf-8')).toBe('new crew content');
  });

  it('should pass crew name in prompt if provided', async () => {
    process.chdir(tempDir);
    const mock = vi.spyOn(crewComposerModule, 'runCrewComposer').mockResolvedValue({
      changes: [{ file: 'CREW.md', type: 'create', new: 'content' }],
      summary: 'Created',
    });

    await crewCommand.subcommands!.write.handler!(['my-crew'], {
      prompt: 'Create a crew',
      apply: true,
    });

    expect(mock).toHaveBeenCalledWith(expect.stringContaining('Crew name: my-crew'), undefined);
  });
});
