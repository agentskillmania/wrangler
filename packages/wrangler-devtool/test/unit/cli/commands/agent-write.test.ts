import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentCommand } from '../../../../src/cli/commands/agent.js';
import { ExitCode } from '../../../../src/cli/options.js';
import * as architectModule from '../../../../src/agents/architect.js';

describe('agent write', () => {
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

  it('should create AGENT.md with --apply (mocked LLM)', async () => {
    process.chdir(tempDir);
    vi.spyOn(architectModule, 'runAgentArchitect').mockResolvedValue({
      changes: [{ file: 'AGENT.md', type: 'create', new: '---\nname: react-agent\n---\n\n# React Agent' }],
      summary: 'Created React agent',
    });

    const code = await agentCommand.subcommands!.write.handler!([], {
      prompt: 'Create a React agent',
      apply: true,
    });

    expect(code).toBe(ExitCode.Success);
    expect(existsSync(join(tempDir, 'AGENT.md'))).toBe(true);
    const content = readFileSync(join(tempDir, 'AGENT.md'), 'utf-8');
    expect(content).toContain('React Agent');
  });

  it('should default to dry-run and not create file', async () => {
    process.chdir(tempDir);
    vi.spyOn(architectModule, 'runAgentArchitect').mockResolvedValue({
      changes: [{ file: 'AGENT.md', type: 'create', new: 'content' }],
      summary: 'Created agent',
    });

    const code = await agentCommand.subcommands!.write.handler!([], {
      prompt: 'Create an agent',
    });

    expect(code).toBe(ExitCode.Success);
    expect(existsSync(join(tempDir, 'AGENT.md'))).toBe(false);
  });

  it('should edit existing AGENT.md with --apply', async () => {
    process.chdir(tempDir);
    writeFileSync(join(tempDir, 'AGENT.md'), '---\nname: old\n---\n\n# Old', 'utf-8');

    vi.spyOn(architectModule, 'runAgentArchitect').mockResolvedValue({
      changes: [
        { file: 'AGENT.md', type: 'edit', old: '---\nname: old\n---\n\n# Old', new: '---\nname: new\n---\n\n# New' },
      ],
      summary: 'Updated agent',
    });

    const code = await agentCommand.subcommands!.write.handler!([], {
      prompt: 'Update the agent',
      apply: true,
    });

    expect(code).toBe(ExitCode.Success);
    const content = readFileSync(join(tempDir, 'AGENT.md'), 'utf-8');
    expect(content).toContain('name: new');
  });

  it('should pass agent name in prompt if provided', async () => {
    process.chdir(tempDir);
    const mock = vi.spyOn(architectModule, 'runAgentArchitect').mockResolvedValue({
      changes: [{ file: 'AGENT.md', type: 'create', new: 'content' }],
      summary: 'Created',
    });

    await agentCommand.subcommands!.write.handler!(['my-agent'], {
      prompt: 'Create an agent',
      apply: true,
    });

    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining('Agent name: my-agent'),
      undefined
    );
  });

  it('should return validation failure if edit old content does not match', async () => {
    process.chdir(tempDir);
    writeFileSync(join(tempDir, 'AGENT.md'), 'actual content', 'utf-8');

    vi.spyOn(architectModule, 'runAgentArchitect').mockResolvedValue({
      changes: [
        { file: 'AGENT.md', type: 'edit', old: 'wrong content', new: 'new content' },
      ],
      summary: 'Updated',
    });

    const code = await agentCommand.subcommands!.write.handler!([], {
      prompt: 'Update',
      apply: true,
    });

    expect(code).toBe(ExitCode.ValidationFailure);
  });
});
