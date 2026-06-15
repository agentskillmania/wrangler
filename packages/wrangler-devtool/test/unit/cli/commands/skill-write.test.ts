import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { skillCommand } from '../../../../src/cli/commands/skill.js';
import { ExitCode } from '../../../../src/cli/options.js';
import * as skillDesignerModule from '../../../../src/agents/skill-designer.js';
import * as configModule from '../../../../src/config.js';

const MOCK_LLM_CONFIG = {
  providers: [
    {
      name: 'openai',
      apiKey: 'sk-test',
      models: [{ modelId: 'gpt-4o' }],
    },
  ],
};

describe('skill write', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
    originalCwd = process.cwd();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(configModule, 'requireLLMConfig').mockResolvedValue(MOCK_LLM_CONFIG);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('should create skill file with --apply (mocked LLM)', async () => {
    process.chdir(tempDir);
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    vi.spyOn(skillDesignerModule, 'runSkillDesigner').mockResolvedValue({
      changes: [
        {
          file: 'skills/refund-handler.md',
          type: 'create',
          new: '---\nname: refund-handler\n---\n\n# Refund Handler',
        },
      ],
      summary: 'Created refund handler skill',
    });

    const code = await skillCommand.subcommands!.write.handler!(['refund-handler'], {
      prompt: 'Handle refund requests',
      apply: true,
    });

    expect(code).toBe(ExitCode.Success);
    expect(existsSync(join(tempDir, 'skills', 'refund-handler.md'))).toBe(true);
  });

  it('should default to dry-run', async () => {
    process.chdir(tempDir);
    vi.spyOn(skillDesignerModule, 'runSkillDesigner').mockResolvedValue({
      changes: [{ file: 'skills/test.md', type: 'create', new: 'content' }],
      summary: 'Created',
    });

    const code = await skillCommand.subcommands!.write.handler!(['test'], {
      prompt: 'Create a skill',
    });

    expect(code).toBe(ExitCode.Success);
    expect(existsSync(join(tempDir, 'skills', 'test.md'))).toBe(false);
  });

  it('should edit existing skill with --apply', async () => {
    process.chdir(tempDir);
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    writeFileSync(join(tempDir, 'skills', 'test.md'), 'old content', 'utf-8');

    vi.spyOn(skillDesignerModule, 'runSkillDesigner').mockResolvedValue({
      changes: [{ file: 'skills/test.md', type: 'edit', old: 'old content', new: 'new content' }],
      summary: 'Updated',
    });

    const code = await skillCommand.subcommands!.write.handler!(['test'], {
      prompt: 'Update skill',
      apply: true,
    });

    expect(code).toBe(ExitCode.Success);
    expect(readFileSync(join(tempDir, 'skills', 'test.md'), 'utf-8')).toBe('new content');
  });

  it('should infer name when not provided', async () => {
    process.chdir(tempDir);
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    const mock = vi.spyOn(skillDesignerModule, 'runSkillDesigner').mockResolvedValue({
      changes: [{ file: 'skills/inferred.md', type: 'create', new: 'content' }],
      summary: 'Created',
    });

    await skillCommand.subcommands!.write.handler!([], {
      prompt: 'Create a skill',
      apply: true,
    });

    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining('Infer a skill name'),
      undefined,
      expect.any(Object)
    );
    expect(existsSync(join(tempDir, 'skills', 'inferred.md'))).toBe(true);
  });
});
