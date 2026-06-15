import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { devtoolRoutes } from '../../../src/routes/devtool.js';

const mockRunAgentArchitect = vi.fn();
const mockRunSkillDesigner = vi.fn();
const mockRunCrewComposer = vi.fn();
const mockRunReviewer = vi.fn();
const mockInitProject = vi.fn();
const mockCreateTemplate = vi.fn();
const mockApplyChanges = vi.fn();
const mockRunTests = vi.fn();

vi.mock('@agentskillmania/wrangler-devtool', () => ({
  DevTool: vi.fn().mockImplementation(() => ({
    runAgentArchitect: mockRunAgentArchitect,
    runSkillDesigner: mockRunSkillDesigner,
    runCrewComposer: mockRunCrewComposer,
    runSessionCurator: vi.fn(),
    runReviewer: mockRunReviewer,
    initProject: mockInitProject,
    createTemplate: mockCreateTemplate,
    applyChanges: mockApplyChanges,
    runTests: mockRunTests,
  })),
}));

describe('Devtool API', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-devtool-api-'));
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: deepseek-chat\nserver:\n  port: 3100\n  host: localhost\n`
    );

    configManager = new ConfigManager(configPath);
    await configManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    await fastify.register(devtoolRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    mockRunAgentArchitect.mockReset();
    mockRunSkillDesigner.mockReset();
    mockRunCrewComposer.mockReset();
    mockRunReviewer.mockReset();
    mockInitProject.mockReset();
    mockCreateTemplate.mockReset();
    mockApplyChanges.mockReset();
    mockRunTests.mockReset();
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  describe('POST /api/devtool/agent/generate', () => {
    it('returns generated agent changes in response body', async () => {
      mockRunAgentArchitect.mockResolvedValue({
        changes: [{ file: 'AGENT.md', type: 'create', new: 'agent content' }],
        summary: 'Created agent',
      });

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create a helpful assistant' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.summary).toBe('Created agent');
      expect(body.changes).toEqual([{ file: 'AGENT.md', type: 'create', new: 'agent content' }]);
    });

    it('calls runAgentArchitect with prompt and no optional args', async () => {
      mockRunAgentArchitect.mockResolvedValue({
        changes: [{ file: 'AGENT.md', type: 'create', new: 'agent content' }],
        summary: 'Created agent',
      });

      await fetch(`${getUrl()}/api/devtool/agent/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create a helpful assistant' }),
      });

      expect(mockRunAgentArchitect).toHaveBeenCalledWith(
        'Create a helpful assistant',
        undefined,
        undefined
      );
    });

    it('passes existingContent and model to DevTool', async () => {
      mockRunAgentArchitect.mockResolvedValue({
        changes: [],
        summary: 'Modified agent',
      });

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Add tool usage',
          existingContent: 'old agent content',
          model: 'gpt-4o',
        }),
      });

      expect(res.ok).toBe(true);
      expect(mockRunAgentArchitect).toHaveBeenCalledWith('Add tool usage', 'old agent content', {
        model: 'gpt-4o',
      });
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/agent/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('prompt is required');
    });

    it('returns 500 when DevTool throws', async () => {
      mockRunAgentArchitect.mockRejectedValue(new Error('LLM API failure'));

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create agent' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('LLM API failure');
    });
  });

  describe('POST /api/devtool/skill/generate', () => {
    it('returns generated skill changes in response body', async () => {
      mockRunSkillDesigner.mockResolvedValue({
        changes: [{ file: 'SKILL.md', type: 'create', new: 'skill content' }],
        summary: 'Created skill',
      });

      const res = await fetch(`${getUrl()}/api/devtool/skill/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create a search skill' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.summary).toBe('Created skill');
      expect(body.changes).toEqual([{ file: 'SKILL.md', type: 'create', new: 'skill content' }]);
    });

    it('calls runSkillDesigner with prompt and no optional args', async () => {
      mockRunSkillDesigner.mockResolvedValue({
        changes: [{ file: 'SKILL.md', type: 'create', new: 'skill content' }],
        summary: 'Created skill',
      });

      await fetch(`${getUrl()}/api/devtool/skill/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create a search skill' }),
      });

      expect(mockRunSkillDesigner).toHaveBeenCalledWith(
        'Create a search skill',
        undefined,
        undefined
      );
    });

    it('passes existingContent and model to DevTool', async () => {
      mockRunSkillDesigner.mockResolvedValue({
        changes: [],
        summary: 'Modified skill',
      });

      const res = await fetch(`${getUrl()}/api/devtool/skill/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Add error handling',
          existingContent: 'old skill',
          model: 'gpt-4o',
        }),
      });

      expect(res.ok).toBe(true);
      expect(mockRunSkillDesigner).toHaveBeenCalledWith('Add error handling', 'old skill', {
        model: 'gpt-4o',
      });
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/skill/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('prompt is required');
    });

    it('returns 500 when DevTool throws', async () => {
      mockRunSkillDesigner.mockRejectedValue(new Error('skill gen failed'));

      const res = await fetch(`${getUrl()}/api/devtool/skill/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create skill' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('skill gen failed');
    });
  });

  describe('POST /api/devtool/crew/generate', () => {
    it('returns generated crew changes in response body', async () => {
      mockRunCrewComposer.mockResolvedValue({
        changes: [{ file: 'CREW.md', type: 'create', new: 'crew content' }],
        summary: 'Created crew',
      });

      const res = await fetch(`${getUrl()}/api/devtool/crew/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create a dev team' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.summary).toBe('Created crew');
      expect(body.changes).toEqual([{ file: 'CREW.md', type: 'create', new: 'crew content' }]);
    });

    it('calls runCrewComposer with prompt and no optional args', async () => {
      mockRunCrewComposer.mockResolvedValue({
        changes: [{ file: 'CREW.md', type: 'create', new: 'crew content' }],
        summary: 'Created crew',
      });

      await fetch(`${getUrl()}/api/devtool/crew/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create a dev team' }),
      });

      expect(mockRunCrewComposer).toHaveBeenCalledWith('Create a dev team', undefined, undefined);
    });

    it('returns 400 when prompt is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/crew/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('prompt is required');
    });

    it('returns 500 when DevTool throws', async () => {
      mockRunCrewComposer.mockRejectedValue(new Error('crew gen failed'));

      const res = await fetch(`${getUrl()}/api/devtool/crew/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Create crew' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('crew gen failed');
    });
  });

  describe('POST /api/devtool/review', () => {
    it('returns review report', async () => {
      mockRunReviewer.mockResolvedValue({
        score: 85,
        issues: [{ severity: 'warning', message: 'Missing description' }],
        summary: 'Agent definition looks good overall',
      });

      const res = await fetch(`${getUrl()}/api/devtool/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: 'agents/my-agent/AGENT.md',
          content: '---\nname: test\n---\nInstructions...',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.score).toBe(85);
      expect(body.issues).toHaveLength(1);
      expect(mockRunReviewer).toHaveBeenCalledWith(
        'agents/my-agent/AGENT.md',
        '---\nname: test\n---\nInstructions...',
        undefined,
        undefined
      );
    });

    it('passes optional prompt and model', async () => {
      mockRunReviewer.mockResolvedValue({ score: 90, issues: [], summary: 'ok' });

      const res = await fetch(`${getUrl()}/api/devtool/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: 'AGENT.md',
          content: 'content',
          prompt: 'Focus on security',
          model: 'gpt-4o',
        }),
      });

      expect(res.ok).toBe(true);
      expect(mockRunReviewer).toHaveBeenCalledWith('AGENT.md', 'content', 'Focus on security', {
        model: 'gpt-4o',
      });
    });

    it('returns 400 when targetPath is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'some content' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('targetPath and content are required');
    });

    it('returns 400 when content is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: 'AGENT.md' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('targetPath and content are required');
    });

    it('returns 500 when DevTool throws', async () => {
      mockRunReviewer.mockRejectedValue(new Error('review failed'));

      const res = await fetch(`${getUrl()}/api/devtool/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: 'AGENT.md', content: 'stuff' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('review failed');
    });
  });

  describe('POST /api/devtool/workspace/init', () => {
    it('initializes project and returns ok', async () => {
      mockInitProject.mockResolvedValue(undefined);

      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/my-workspace', type: 'agent' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockInitProject).toHaveBeenCalledWith('/tmp/my-workspace', { type: 'agent' });
    });

    it('returns 400 when path is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('path and type are required');
    });

    it('returns 400 when type is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/ws' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('path and type are required');
    });

    it('returns 400 for invalid type', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/ws', type: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('type must be agent, crew, or skill');
    });

    it('passes noGit option', async () => {
      mockInitProject.mockResolvedValue(undefined);

      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/ws', type: 'crew', noGit: true }),
      });

      expect(res.ok).toBe(true);
      expect(mockInitProject).toHaveBeenCalledWith('/tmp/ws', {
        type: 'crew',
        noGit: true,
      });
    });
  });

  describe('POST /api/devtool/template', () => {
    it('creates template and returns filePath', async () => {
      mockCreateTemplate.mockResolvedValue('/tmp/ws/agents/test-agent/AGENT.md');

      const res = await fetch(`${getUrl()}/api/devtool/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent', name: 'test-agent', cwd: '/tmp/ws' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.filePath).toBe('/tmp/ws/agents/test-agent/AGENT.md');
      expect(mockCreateTemplate).toHaveBeenCalledWith('agent', 'test-agent', '/tmp/ws');
    });

    it('returns 400 when type is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', cwd: '/tmp/ws' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('type, name, and cwd are required');
    });

    it('returns 400 for invalid type', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'invalid', name: 'test', cwd: '/tmp/ws' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('type must be agent, skill, crew, or session');
    });
  });

  describe('POST /api/devtool/changes/apply', () => {
    it('applies changes and returns result', async () => {
      mockApplyChanges.mockResolvedValue({ applied: true });

      const changes = [{ file: 'AGENT.md', type: 'create', new: 'content' }];
      const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes, cwd: '/tmp/ws' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(mockApplyChanges).toHaveBeenCalledWith(changes, { cwd: '/tmp/ws' });
    });

    it('passes dryRun option', async () => {
      mockApplyChanges.mockResolvedValue({ applied: false, error: 'Dry run' });

      const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [{ file: 'a.txt', type: 'create', new: 'x' }],
          dryRun: true,
        }),
      });

      expect(res.ok).toBe(true);
      expect(mockApplyChanges).toHaveBeenCalledWith([{ file: 'a.txt', type: 'create', new: 'x' }], {
        dryRun: true,
      });
    });

    it('returns 400 when changes is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('changes array is required');
    });

    it('returns 400 when changes is empty', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: [] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('changes array is required');
    });
  });

  describe('POST /api/devtool/test/run', () => {
    it('returns test report in response body', async () => {
      mockRunTests.mockResolvedValue({
        total: 3,
        passed: 2,
        failed: 1,
        results: [
          { name: 'test1', status: 'passed' },
          { name: 'test2', status: 'passed' },
          { name: 'test3', status: 'failed', error: 'Expected X' },
        ],
      });

      const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: 'agents/my-agent' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.total).toBe(3);
      expect(body.passed).toBe(2);
      expect(body.failed).toBe(1);
    });

    it('calls runTests with targetPath and empty options by default', async () => {
      mockRunTests.mockResolvedValue({
        total: 3,
        passed: 2,
        failed: 1,
        results: [],
      });

      await fetch(`${getUrl()}/api/devtool/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: 'agents/my-agent' }),
      });

      expect(mockRunTests).toHaveBeenCalledWith('agents/my-agent', {});
    });

    it('passes case and hardOnly options', async () => {
      mockRunTests.mockResolvedValue({ total: 1, passed: 1, failed: 0, results: [] });

      const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: 'agents/my-agent',
          case: 'should respond politely',
          hardOnly: true,
        }),
      });

      expect(res.ok).toBe(true);
      expect(mockRunTests).toHaveBeenCalledWith('agents/my-agent', {
        case: 'should respond politely',
        hardOnly: true,
      });
    });

    it('returns 400 when targetPath is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('targetPath is required');
    });
  });

  // Cross-cutting: error handling for file operation routes
  describe('error handling', () => {
    it('POST /api/devtool/workspace/init returns 500 on failure', async () => {
      mockInitProject.mockRejectedValue(new Error('disk full'));

      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/ws', type: 'agent' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('disk full');
    });

    it('POST /api/devtool/template returns 500 on failure', async () => {
      mockCreateTemplate.mockRejectedValue(new Error('permission denied'));

      const res = await fetch(`${getUrl()}/api/devtool/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent', name: 'test', cwd: '/tmp/ws' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('permission denied');
    });

    it('POST /api/devtool/changes/apply returns 500 on failure', async () => {
      mockApplyChanges.mockRejectedValue(new Error('write failed'));

      const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [{ file: 'a.txt', type: 'create', new: 'x' }],
        }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('write failed');
    });

    it('POST /api/devtool/test/run returns 500 on failure', async () => {
      mockRunTests.mockRejectedValue(new Error('test crash'));

      const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: 'agents/x' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('test crash');
    });

    it('returns Unknown error when thrown value is not an Error', async () => {
      mockRunAgentArchitect.mockRejectedValue('string error');

      const res = await fetch(`${getUrl()}/api/devtool/agent/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Unknown error');
    });
  });
});
