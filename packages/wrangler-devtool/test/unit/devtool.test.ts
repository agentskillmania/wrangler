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

const {
  runAgentArchitectMock,
  runSkillDesignerMock,
  runCrewComposerMock,
  runReviewerMock,
  runSessionCuratorMock,
  createArchitectRunnerMock,
  createSkillDesignerRunnerMock,
  createCrewComposerRunnerMock,
  createReviewerRunnerMock,
  createCuratorRunnerWrapperMock,
  mockOutput,
  mockRunnerResult,
} = vi.hoisted(() => {
  const output = {
    changes: [{ file: 'AGENT.md', type: 'create' as const, new: '# Test' }],
    summary: 'Generated agent definition',
  };
  const mockReport = {
    overallScore: 4,
    dimensions: {
      clarity: { score: 4, reasoning: 'Clear' },
      completeness: { score: 3, reasoning: 'Mostly complete' },
      focus: { score: 5, reasoning: 'Well focused' },
      safety: { score: 4, reasoning: 'Safe' },
      efficiency: { score: 3, reasoning: 'Reasonable' },
    },
    issues: [],
    summary: 'Good definition',
  };
  const mockSummary = { title: 'Test Session', description: 'A test session summary' };
  const mockRunnerResult = {
    runner: { run: vi.fn(), runStream: vi.fn(), on: vi.fn().mockReturnThis() },
    state: { config: { name: 'test', instructions: '', tools: [] }, context: { messages: [] } },
  };
  return {
    runAgentArchitectMock: vi.fn().mockResolvedValue(output),
    runSkillDesignerMock: vi.fn().mockResolvedValue(output),
    runCrewComposerMock: vi.fn().mockResolvedValue(output),
    runReviewerMock: vi.fn().mockResolvedValue(mockReport),
    runSessionCuratorMock: vi.fn().mockResolvedValue(mockSummary),
    createArchitectRunnerMock: vi.fn().mockResolvedValue(mockRunnerResult),
    createSkillDesignerRunnerMock: vi.fn().mockResolvedValue(mockRunnerResult),
    createCrewComposerRunnerMock: vi.fn().mockResolvedValue(mockRunnerResult),
    createReviewerRunnerMock: vi.fn().mockResolvedValue(mockRunnerResult),
    createCuratorRunnerWrapperMock: vi.fn().mockResolvedValue(mockRunnerResult),
    mockOutput: output,
    mockRunnerResult,
  };
});

vi.mock('../../src/agents/architect.js', () => ({
  runAgentArchitect: runAgentArchitectMock,
  createArchitectRunner: createArchitectRunnerMock,
}));

vi.mock('../../src/agents/skill-designer.js', () => ({
  runSkillDesigner: runSkillDesignerMock,
  createSkillDesignerRunner: createSkillDesignerRunnerMock,
}));

vi.mock('../../src/agents/crew-composer.js', () => ({
  runCrewComposer: runCrewComposerMock,
  createCrewComposerRunner: createCrewComposerRunnerMock,
}));

vi.mock('../../src/agents/reviewer.js', () => ({
  runReviewer: runReviewerMock,
  createReviewerRunner: createReviewerRunnerMock,
}));

vi.mock('../../src/agents/session-curator.js', () => ({
  runSessionCurator: runSessionCuratorMock,
  createCuratorRunnerWrapper: createCuratorRunnerWrapperMock,
}));

import type { DevToolOptions } from '../../src/devtool.js';
import { DevTool } from '../../src/devtool.js';

const VALID_LLM_CONFIG = {
  providers: [
    {
      name: 'openai',
      apiKey: 'sk-test-key',
      models: [{ modelId: 'gpt-4o' }],
    },
  ],
};

const DEFAULT_MODEL = 'gpt-4o';

describe('DevTool', () => {
  describe('constructor', () => {
    it('creates instance with explicit LLM config', () => {
      const tool = new DevTool({ llm: VALID_LLM_CONFIG });

      expect(tool).toBeInstanceOf(DevTool);
      expect(tool.maxSteps).toBeUndefined();
      expect(tool.requestTimeout).toBeUndefined();
    });

    it('throws on missing LLM config', () => {
      expect(() => new DevTool({} as DevToolOptions)).toThrow(/llm configuration is required/i);
    });

    it('throws on invalid LLM config — missing providers', () => {
      expect(
        () =>
          new DevTool({
            llm: {} as DevToolOptions['llm'],
          })
      ).toThrow(/providers.*required/i);
    });

    it('throws on invalid LLM config — missing apiKey', () => {
      expect(
        () =>
          new DevTool({
            llm: {
              providers: [{ name: 'openai', models: [{ modelId: 'gpt-4o' }] }],
            } as DevToolOptions['llm'],
          })
      ).toThrow(/apiKey.*required/i);
    });

    it('throws on invalid LLM config — missing modelId', () => {
      expect(
        () =>
          new DevTool({
            llm: {
              providers: [{ name: 'openai', apiKey: 'sk-test', models: [{}] }],
            } as DevToolOptions['llm'],
          })
      ).toThrow(/modelId.*required/i);
    });

    it('accepts optional baseUrl in LLM config', () => {
      const tool = new DevTool({
        llm: {
          providers: [
            {
              name: 'openai',
              apiKey: 'sk-test-key',
              baseUrl: 'https://custom.api.com/v1',
              models: [{ modelId: 'gpt-4o' }],
            },
          ],
        },
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
      expect(tool.maxSteps).toBe(50);
      expect(tool.requestTimeout).toBe(60000);
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
      await writeFile(
        configPath,
        `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\n`
      );

      const tool = await DevTool.fromConfig(tempDir);

      expect(tool).toBeInstanceOf(DevTool);
    });

    it('creates instance from explicit config path', async () => {
      const configPath = join(tempDir, 'custom.yaml');
      await writeFile(
        configPath,
        `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      models:\n        - modelId: gpt-4o\n`
      );

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
      await writeFile(configPath, `llm:\n  providers:\n    - name: openai\n`);

      await expect(
        DevTool.fromConfig(tempDir, { extraPaths: [configPath], skipGlobal: true })
      ).rejects.toThrow(/no valid llm configuration/i);
    });
  });

  describe('agent methods', () => {
    let tool: InstanceType<typeof DevTool>;

    beforeEach(() => {
      tool = new DevTool({ llm: VALID_LLM_CONFIG });
      runAgentArchitectMock.mockClear();
      runAgentArchitectMock.mockResolvedValue(mockOutput);
    });

    it('runAgentArchitect returns wrapper output', async () => {
      const result = await tool.runAgentArchitect('Create a review agent');

      expect(result).toEqual(mockOutput);
    });

    it('runAgentArchitect passes prompt and default model to wrapper', async () => {
      await tool.runAgentArchitect('Create a review agent');

      expect(runAgentArchitectMock).toHaveBeenCalledOnce();
      const [prompt, existingContent, config] = runAgentArchitectMock.mock.calls[0]!;
      expect(prompt).toBe('Create a review agent');
      expect(existingContent).toBeUndefined();
      expect(config.model).toBe(DEFAULT_MODEL);
      expect(config.llmClient).toBeDefined();
    });

    it('runAgentArchitect passes existingContent and custom options to wrapper', async () => {
      await tool.runAgentArchitect('Modify', 'existing content', {
        model: 'gpt-4o-mini',
        timeout: 30000,
      });

      expect(runAgentArchitectMock).toHaveBeenCalledOnce();
      const [prompt, content, config] = runAgentArchitectMock.mock.calls[0]!;
      expect(prompt).toBe('Modify');
      expect(content).toBe('existing content');
      expect(config.model).toBe('gpt-4o-mini');
      expect(config.timeout).toBe(30000);
    });

    it('runSkillDesigner delegates to wrapper', async () => {
      runSkillDesignerMock.mockClear();
      runSkillDesignerMock.mockResolvedValue(mockOutput);

      const result = await tool.runSkillDesigner('Design a testing skill');

      expect(result).toEqual(mockOutput);
      expect(runSkillDesignerMock).toHaveBeenCalledOnce();
      const [prompt] = runSkillDesignerMock.mock.calls[0]!;
      expect(prompt).toBe('Design a testing skill');
    });

    it('runCrewComposer delegates to wrapper', async () => {
      runCrewComposerMock.mockClear();
      runCrewComposerMock.mockResolvedValue(mockOutput);

      const result = await tool.runCrewComposer('Compose a dev team');

      expect(result).toEqual(mockOutput);
      expect(runCrewComposerMock).toHaveBeenCalledOnce();
      const [prompt] = runCrewComposerMock.mock.calls[0]!;
      expect(prompt).toBe('Compose a dev team');
    });

    it('runSessionCurator delegates to wrapper', async () => {
      const result = await tool.runSessionCurator('Summarize this conversation');

      expect(result).toEqual({ title: 'Test Session', description: 'A test session summary' });
      expect(runSessionCuratorMock).toHaveBeenCalledOnce();
      const [text] = runSessionCuratorMock.mock.calls[0]!;
      expect(text).toBe('Summarize this conversation');
    });
  });

  describe('create*Runner methods', () => {
    let tool: InstanceType<typeof DevTool>;

    beforeEach(() => {
      tool = new DevTool({ llm: VALID_LLM_CONFIG });
    });

    it('createArchitectRunner delegates to wrapper module', async () => {
      const result = await tool.createArchitectRunner();

      expect(createArchitectRunnerMock).toHaveBeenCalledOnce();
      expect(result).toEqual(mockRunnerResult);
    });

    it('createSkillDesignerRunner delegates to wrapper module', async () => {
      const result = await tool.createSkillDesignerRunner();

      expect(createSkillDesignerRunnerMock).toHaveBeenCalledOnce();
      expect(result).toEqual(mockRunnerResult);
    });

    it('createCrewComposerRunner delegates to wrapper module', async () => {
      const result = await tool.createCrewComposerRunner();

      expect(createCrewComposerRunnerMock).toHaveBeenCalledOnce();
      expect(result).toEqual(mockRunnerResult);
    });

    it('createReviewerRunner delegates to wrapper module', async () => {
      const result = await tool.createReviewerRunner();

      expect(createReviewerRunnerMock).toHaveBeenCalledOnce();
      expect(result).toEqual(mockRunnerResult);
    });

    it('createSessionCuratorRunner delegates to wrapper module', async () => {
      const result = await tool.createSessionCuratorRunner();

      expect(createCuratorRunnerWrapperMock).toHaveBeenCalledOnce();
      expect(result).toEqual(mockRunnerResult);
    });
  });

  describe('runReviewer', () => {
    let tool: InstanceType<typeof DevTool>;

    beforeEach(() => {
      tool = new DevTool({ llm: VALID_LLM_CONFIG });
      runReviewerMock.mockClear();
      runReviewerMock.mockResolvedValue({
        overallScore: 4,
        dimensions: {
          clarity: { score: 4, reasoning: 'Clear' },
          completeness: { score: 3, reasoning: 'Mostly complete' },
          focus: { score: 5, reasoning: 'Well focused' },
          safety: { score: 4, reasoning: 'Safe' },
          efficiency: { score: 3, reasoning: 'Reasonable' },
        },
        issues: [],
        summary: 'Good definition',
      });
    });

    it('returns wrapper review report', async () => {
      const result = await tool.runReviewer('AGENT.md', '# My Agent');

      expect(result.overallScore).toBe(4);
    });

    it('passes target path and content to wrapper', async () => {
      await tool.runReviewer('AGENT.md', '# My Agent');

      expect(runReviewerMock).toHaveBeenCalledOnce();
      const [targetPath, content] = runReviewerMock.mock.calls[0]!;
      expect(targetPath).toBe('AGENT.md');
      expect(content).toBe('# My Agent');
    });

    it('passes additional prompt and options to wrapper', async () => {
      await tool.runReviewer('AGENT.md', '# My Agent', 'Focus on safety', {
        model: 'gpt-4o-mini',
        timeout: 30000,
      });

      expect(runReviewerMock).toHaveBeenCalledOnce();
      const [, , prompt, config] = runReviewerMock.mock.calls[0]!;
      expect(prompt).toBe('Focus on safety');
      expect(config.model).toBe('gpt-4o-mini');
      expect(config.timeout).toBe(30000);
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

    it('initProject creates agent workspace with AGENT.md', async () => {
      const wsDir = join(tempDir, 'agent-ws');

      await tool.initProject(wsDir, { type: 'agent' });

      const { existsSync } = await import('node:fs');
      expect(existsSync(join(wsDir, 'AGENT.md'))).toBe(true);
      expect(existsSync(join(wsDir, 'mcp.json'))).toBe(true);
      expect(existsSync(join(wsDir, 'skills'))).toBe(true);
      expect(existsSync(join(wsDir, 'test'))).toBe(true);
    });

    it('initProject creates crew workspace with CREW.md', async () => {
      const wsDir = join(tempDir, 'crew-ws');

      await tool.initProject(wsDir, { type: 'crew' });

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
