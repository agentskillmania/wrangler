import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewCommand } from '../../../../src/cli/commands/review.js';
import { ExitCode } from '../../../../src/cli/options.js';
import * as reviewerModule from '../../../../src/agents/reviewer.js';
import * as configModule from '../../../../src/config.js';

describe('review command', () => {
  let tempDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-review-test-'));
    originalCwd = process.cwd();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
    logSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('should reject missing path', async () => {
    await expect(reviewCommand.handler!([], {})).rejects.toThrow('Review target path is required');
  });

  it('should reject non-existent path', async () => {
    await expect(reviewCommand.handler!(['nonexistent'], {})).rejects.toThrow(
      'Path does not exist'
    );
  });

  it('should run static checks on valid agent workspace', async () => {
    process.chdir(tempDir);
    writeFileSync(
      join(tempDir, 'AGENT.md'),
      '---\nname: test-agent\ndescription: A test agent\n---\n\n# Test Agent\n',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    mkdirSync(join(tempDir, 'test'), { recursive: true });

    const code = await reviewCommand.handler!([tempDir], {});
    expect(code).toBe(ExitCode.Success);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.static.passed).toBe(true);
    expect(output.static.issues).toHaveLength(0);
  });

  it('should report missing frontmatter in static check', async () => {
    process.chdir(tempDir);
    writeFileSync(join(tempDir, 'AGENT.md'), 'No frontmatter here\n', 'utf-8');
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    mkdirSync(join(tempDir, 'test'), { recursive: true });

    const code = await reviewCommand.handler!([tempDir], {});
    expect(code).toBe(ExitCode.GeneralError);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.static.passed).toBe(false);
    expect(
      output.static.issues.some((i: any) => i.description.includes('missing YAML frontmatter'))
    ).toBe(true);
  });

  it('should report missing name field in static check', async () => {
    process.chdir(tempDir);
    writeFileSync(
      join(tempDir, 'AGENT.md'),
      '---\ndescription: A test agent\n---\n\n# Test Agent\n',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    mkdirSync(join(tempDir, 'test'), { recursive: true });

    const code = await reviewCommand.handler!([tempDir], {});
    expect(code).toBe(ExitCode.GeneralError);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.static.issues.some((i: any) => i.description.includes('missing "name"'))).toBe(
      true
    );
  });

  it('should report missing skills and test dirs', async () => {
    process.chdir(tempDir);
    writeFileSync(
      join(tempDir, 'AGENT.md'),
      '---\nname: test-agent\ndescription: A test agent\n---\n\n# Test Agent\n',
      'utf-8'
    );

    const code = await reviewCommand.handler!([tempDir], {});
    expect(code).toBe(ExitCode.Success);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.static.issues.some((i: any) => i.description.includes('skills/'))).toBe(true);
    expect(output.static.issues.some((i: any) => i.description.includes('test/'))).toBe(true);
  });

  it('should run static checks on a single file', async () => {
    process.chdir(tempDir);
    const filePath = join(tempDir, 'skill.md');
    writeFileSync(
      filePath,
      '---\nname: test-skill\ndescription: A test skill\n---\n\n# Test Skill\n',
      'utf-8'
    );

    const code = await reviewCommand.handler!([filePath], {});
    expect(code).toBe(ExitCode.Success);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.static.passed).toBe(true);
  });

  it('should report short file content', async () => {
    process.chdir(tempDir);
    const filePath = join(tempDir, 'skill.md');
    writeFileSync(filePath, '---\nname: test\ndescription: x\n---\n\nshort\n', 'utf-8');

    const code = await reviewCommand.handler!([filePath], {});
    expect(code).toBe(ExitCode.Success);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.static.issues.some((i: any) => i.description.includes('very short'))).toBe(true);
  });

  it('should report non-markdown file', async () => {
    process.chdir(tempDir);
    const filePath = join(tempDir, 'agent.txt');
    writeFileSync(filePath, '---\nname: test\n---\n', 'utf-8');

    const code = await reviewCommand.handler!([filePath], {});
    expect(code).toBe(ExitCode.Success);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.static.issues.some((i: any) => i.description.includes('non-Markdown'))).toBe(
      true
    );
  });

  it('should run deep review with mocked LLM', async () => {
    process.chdir(tempDir);
    writeFileSync(
      join(tempDir, 'AGENT.md'),
      '---\nname: test-agent\ndescription: A test agent\n---\n\n# Test Agent\nSome detailed content here that is longer than one hundred characters to avoid the short content warning.\n',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    mkdirSync(join(tempDir, 'test'), { recursive: true });

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
    });
    vi.spyOn(reviewerModule, 'runReviewer').mockResolvedValue({
      overallScore: 4,
      dimensions: {
        clarity: { score: 4, reasoning: 'Clear' },
        completeness: { score: 3, reasoning: 'Missing' },
        focus: { score: 5, reasoning: 'Focused' },
        safety: { score: 4, reasoning: 'Safe' },
        efficiency: { score: 4, reasoning: 'Efficient' },
      },
      issues: [],
      summary: 'Good quality agent',
    });

    const code = await reviewCommand.handler!([tempDir], { deep: true });
    expect(code).toBe(ExitCode.Success);

    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.deep).not.toBeNull();
    expect(output.deep.overallScore).toBe(4);
  });

  it('should fail deep review without LLM config', async () => {
    process.chdir(tempDir);
    writeFileSync(
      join(tempDir, 'AGENT.md'),
      '---\nname: test-agent\ndescription: A test agent\n---\n\n# Test Agent\n',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    mkdirSync(join(tempDir, 'test'), { recursive: true });

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue(null);

    await expect(reviewCommand.handler!([tempDir], { deep: true })).rejects.toThrow(
      'No LLM configuration found'
    );
  });

  it('should pass custom prompt to deep review', async () => {
    process.chdir(tempDir);
    writeFileSync(
      join(tempDir, 'AGENT.md'),
      '---\nname: test-agent\ndescription: A test agent\n---\n\n# Test Agent\nSome detailed content here that is longer than one hundred characters to avoid the short content warning.\n',
      'utf-8'
    );
    mkdirSync(join(tempDir, 'skills'), { recursive: true });
    mkdirSync(join(tempDir, 'test'), { recursive: true });

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
      llm: { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
    });
    const mockReviewer = vi.spyOn(reviewerModule, 'runReviewer').mockResolvedValue({
      overallScore: 5,
      dimensions: {
        clarity: { score: 5, reasoning: 'Clear' },
        completeness: { score: 5, reasoning: 'Complete' },
        focus: { score: 5, reasoning: 'Focused' },
        safety: { score: 5, reasoning: 'Safe' },
        efficiency: { score: 5, reasoning: 'Efficient' },
      },
      issues: [],
      summary: 'Excellent',
    });

    await reviewCommand.handler!([tempDir], { deep: true, prompt: 'check for security issues' });

    expect(mockReviewer).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'check for security issues'
    );
  });
});
