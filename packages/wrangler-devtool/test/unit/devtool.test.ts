/**
 * @fileoverview DevTool facade tests
 *
 * When tests fail, question the implementation first, not the test.
 * Never change test expectations to match current implementation without analysis.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { runAgentMock, runReviewAgentMock, runSessionCuratorAgentMock, mockOutput } = vi.hoisted(
  () => {
    const output = {
      changes: [{ file: 'AGENT.md', type: 'create' as const, content: '# Test' }],
      summary: 'Generated agent definition',
    };
    const mockSummary = { title: 'Test Session', description: 'A test session summary' };
    return {
      runAgentMock: vi.fn().mockResolvedValue(output),
      runReviewAgentMock: vi.fn(),
      runSessionCuratorAgentMock: vi.fn().mockResolvedValue(mockSummary),
      mockOutput: output,
    };
  }
);

vi.mock('../../src/agents/orchestrator.js', () => ({
  runAgent: runAgentMock,
  runReviewAgent: runReviewAgentMock,
  runSessionCuratorAgent: runSessionCuratorAgentMock,
  loadPromptTemplate: vi.fn().mockResolvedValue('template'),
  assemblePrompt: vi.fn().mockReturnValue('assembled'),
  parseAgentOutput: vi.fn(),
  parseReviewReport: vi.fn(),
  callAgentLLM: vi.fn(),
}));

import type { DevToolOptions } from '../../src/devtool.js';
import { DevTool } from '../../src/devtool.js';

const VALID_LLM_CONFIG = {
  provider: 'openai',
  apiKey: 'sk-test-key',
  model: 'gpt-4o',
} as const;

describe('DevTool', () => {
  describe('constructor', () => {
    it('creates instance with explicit LLM config', () => {
      const tool = new DevTool({ llm: VALID_LLM_CONFIG });

      expect(tool).toBeInstanceOf(DevTool);
    });

    it('throws on missing LLM config', () => {
      expect(() => new DevTool({} as DevToolOptions)).toThrow(/llm configuration is required/i);
    });

    it('throws on invalid LLM config — missing provider', () => {
      expect(
        () =>
          new DevTool({
            llm: { apiKey: 'sk-test', model: 'gpt-4o' } as DevToolOptions['llm'],
          })
      ).toThrow(/provider.*required/i);
    });

    it('throws on invalid LLM config — missing apiKey', () => {
      expect(
        () =>
          new DevTool({
            llm: { provider: 'openai', model: 'gpt-4o' } as DevToolOptions['llm'],
          })
      ).toThrow(/apiKey.*required/i);
    });

    it('throws on invalid LLM config — missing model', () => {
      expect(
        () =>
          new DevTool({
            llm: { provider: 'openai', apiKey: 'sk-test' } as DevToolOptions['llm'],
          })
      ).toThrow(/model.*required/i);
    });

    it('accepts optional baseUrl in LLM config', () => {
      const tool = new DevTool({
        llm: { ...VALID_LLM_CONFIG, baseUrl: 'https://custom.api.com/v1' },
      });
      expect(tool).toBeInstanceOf(DevTool);
    });

    it('accepts optional maxSteps and requestTimeout', () => {
      const tool = new DevTool({
        llm: VALID_LLM_CONFIG,
        maxSteps: 50,
        requestTimeout: 60000,
      });
      expect(tool).toBeInstanceOf(DevTool);
    });
  });

  describe('fromConfig', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `devtool-cfg-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('creates instance from wrangler.yaml file', async () => {
      const configPath = join(tempDir, 'wrangler.yaml');
      await writeFile(configPath, `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n`);

      const tool = await DevTool.fromConfig(tempDir);

      expect(tool).toBeInstanceOf(DevTool);
    });

    it('creates instance from explicit config path', async () => {
      const configPath = join(tempDir, 'custom.yaml');
      await writeFile(configPath, `llm:\n  provider: openai\n  apiKey: sk-test\n  model: gpt-4o\n`);

      const tool = await DevTool.fromConfig(tempDir, { extraPaths: [configPath] });

      expect(tool).toBeInstanceOf(DevTool);
    });

    it('throws when no config found', async () => {
      await expect(DevTool.fromConfig(tempDir, { skipGlobal: true })).rejects.toThrow(
        /no valid llm configuration/i
      );
    });

    it('throws when config has invalid LLM section', async () => {
      const configPath = join(tempDir, 'wrangler.yaml');
      await writeFile(configPath, `llm:\n  provider: openai\n`);

      await expect(
        DevTool.fromConfig(tempDir, { extraPaths: [configPath], skipGlobal: true })
      ).rejects.toThrow(/no valid llm configuration/i);
    });
  });

  describe('agent methods', () => {
    let tool: InstanceType<typeof DevTool>;

    beforeEach(() => {
      tool = new DevTool({ llm: VALID_LLM_CONFIG });
      runAgentMock.mockClear();
      runAgentMock.mockResolvedValue(mockOutput);
    });

    it('runAgentArchitect delegates to runAgent with architect template', async () => {
      const result = await tool.runAgentArchitect('Create a review agent');

      expect(result).toEqual(mockOutput);
      expect(runAgentMock).toHaveBeenCalledOnce();
      const [, model, templateName, prompt] = runAgentMock.mock.calls[0]!;
      expect(model).toBe('gpt-4o');
      expect(templateName).toBe('architect');
      expect(prompt).toBe('Create a review agent');
    });

    it('runAgentArchitect passes existingContent and options', async () => {
      await tool.runAgentArchitect('Modify', 'existing content', {
        model: 'gpt-4o-mini',
        timeout: 30000,
      });

      expect(runAgentMock).toHaveBeenCalledOnce();
      const [, model, , prompt, content, opts] = runAgentMock.mock.calls[0]!;
      expect(model).toBe('gpt-4o-mini');
      expect(prompt).toBe('Modify');
      expect(content).toBe('existing content');
      expect(opts).toEqual({ model: 'gpt-4o-mini', timeout: 30000 });
    });

    it('runSkillDesigner delegates to runAgent with skill-designer template', async () => {
      const result = await tool.runSkillDesigner('Design a testing skill');

      expect(result).toEqual(mockOutput);
      expect(runAgentMock).toHaveBeenCalledOnce();
      const [, model, templateName] = runAgentMock.mock.calls[0]!;
      expect(model).toBe('gpt-4o');
      expect(templateName).toBe('skill-designer');
    });

    it('runCrewComposer delegates to runAgent with crew-composer template', async () => {
      const result = await tool.runCrewComposer('Compose a dev team');

      expect(result).toEqual(mockOutput);
      expect(runAgentMock).toHaveBeenCalledOnce();
      const [, , templateName] = runAgentMock.mock.calls[0]!;
      expect(templateName).toBe('crew-composer');
    });

    it('runSessionCurator delegates to runSessionCuratorAgent', async () => {
      const result = await tool.runSessionCurator('Summarize this conversation');

      expect(result).toEqual({ title: 'Test Session', description: 'A test session summary' });
      expect(runSessionCuratorAgentMock).toHaveBeenCalledOnce();
    });
  });

  describe('runReviewer', () => {
    let tool: InstanceType<typeof DevTool>;
    const mockReport = {
      overallScore: 8,
      dimensions: {
        clarity: { score: 8, reasoning: 'Clear' },
        completeness: { score: 7, reasoning: 'Mostly complete' },
        focus: { score: 9, reasoning: 'Well focused' },
        safety: { score: 8, reasoning: 'Safe' },
        efficiency: { score: 7, reasoning: 'Reasonable' },
      },
      issues: [],
      summary: 'Good definition',
    };

    beforeEach(() => {
      tool = new DevTool({ llm: VALID_LLM_CONFIG });
      runReviewAgentMock.mockClear();
      runReviewAgentMock.mockResolvedValue(mockReport);
    });

    it('delegates to runReviewAgent with target and content', async () => {
      const result = await tool.runReviewer('AGENT.md', '# My Agent');

      expect(result).toEqual(mockReport);
      expect(runReviewAgentMock).toHaveBeenCalledOnce();
      const [client, model, prompt, options] = runReviewAgentMock.mock.calls[0]!;
      expect(model).toBe('gpt-4o');
      expect(prompt).toContain('AGENT.md');
      expect(options).toBeUndefined();
    });

    it('includes additional prompt when provided', async () => {
      await tool.runReviewer('AGENT.md', '# My Agent', 'Focus on safety');

      expect(runReviewAgentMock).toHaveBeenCalledOnce();
      const [, , prompt] = runReviewAgentMock.mock.calls[0]!;
      expect(prompt).toContain('Focus on safety');
    });

    it('passes options through', async () => {
      await tool.runReviewer('AGENT.md', '# My Agent', undefined, {
        model: 'gpt-4o-mini',
        timeout: 30000,
      });

      expect(runReviewAgentMock).toHaveBeenCalledOnce();
      const [, model, , opts] = runReviewAgentMock.mock.calls[0]!;
      expect(model).toBe('gpt-4o-mini');
      expect(opts).toEqual({ model: 'gpt-4o-mini', timeout: 30000 });
    });
  });

  describe('file operations', () => {
    let tool: InstanceType<typeof DevTool>;
    let tempDir: string;

    beforeEach(async () => {
      tool = new DevTool({ llm: VALID_LLM_CONFIG });
      tempDir = join(tmpdir(), `devtool-file-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('initWorkspace creates agent workspace with AGENT.md', async () => {
      const wsDir = join(tempDir, 'agent-ws');

      await tool.initWorkspace(wsDir, { mode: 'agent' });

      const { existsSync } = await import('node:fs');
      expect(existsSync(join(wsDir, 'AGENT.md'))).toBe(true);
      expect(existsSync(join(wsDir, 'mcp.json'))).toBe(true);
      expect(existsSync(join(wsDir, 'skills'))).toBe(true);
      expect(existsSync(join(wsDir, 'test'))).toBe(true);
    });

    it('initWorkspace creates crew workspace with CREW.md', async () => {
      const wsDir = join(tempDir, 'crew-ws');

      await tool.initWorkspace(wsDir, { mode: 'crew' });

      const { existsSync } = await import('node:fs');
      expect(existsSync(join(wsDir, 'CREW.md'))).toBe(true);
      expect(existsSync(join(wsDir, 'agents'))).toBe(true);
    });

    it('createTemplate creates a skill file', async () => {
      const filePath = await tool.createTemplate('skill', 'my-skill', tempDir);

      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toMatch(/^---\nname: my-skill\n/);
      expect(content).toContain('description: A new skill');
    });

    it('createTemplate creates an agent file', async () => {
      const filePath = await tool.createTemplate('agent', 'my-agent', tempDir);

      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toMatch(/^---\nname: my-agent\n/);
    });

    it('applyChanges applies file changes', async () => {
      const changes = [{ file: 'new-file.txt', type: 'create' as const, new: 'hello world' }];

      const result = await tool.applyChanges(changes, { cwd: tempDir });

      if (result.error) {
        throw new Error(`applyChanges failed: ${result.error}`);
      }
      expect(result.applied).toBe(true);
      const { readFileSync } = await import('node:fs');
      expect(readFileSync(join(tempDir, 'new-file.txt'), 'utf-8')).toBe('hello world');
    });
  });

  describe('test runner', () => {
    it('runTests delegates to TestRunner.run', async () => {
      const tool = new DevTool({ llm: VALID_LLM_CONFIG });

      const mockReport = {
        suites: [],
        summary: { total: 0, passed: 0, failed: 0, duration: 0, hardPassed: 0, hardFailed: 0 },
      };

      const { TestRunner } = await import('../../src/test-runner/runner.js');
      const runSpy = vi.spyOn(TestRunner.prototype, 'run').mockResolvedValue(mockReport);

      const report = await tool.runTests('/path/to/tests');

      expect(report).toEqual(mockReport);
      expect(runSpy).toHaveBeenCalledWith('/path/to/tests', {});
      runSpy.mockRestore();
    });

    it('runTests passes options to TestRunner', async () => {
      const tool = new DevTool({ llm: VALID_LLM_CONFIG });

      const mockReport = {
        suites: [],
        summary: { total: 0, passed: 0, failed: 0, duration: 0, hardPassed: 0, hardFailed: 0 },
      };

      const { TestRunner } = await import('../../src/test-runner/runner.js');
      const runSpy = vi.spyOn(TestRunner.prototype, 'run').mockResolvedValue(mockReport);

      await tool.runTests('/path/to/tests', { case: 'my-test', hardOnly: true });

      expect(runSpy).toHaveBeenCalledWith('/path/to/tests', {
        case: 'my-test',
        hardOnly: true,
      });
      runSpy.mockRestore();
    });
  });
});
