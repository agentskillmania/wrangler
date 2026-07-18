import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { devtoolRoutes } from '../../../src/routes/devtool.js';

const {
  mockInitProject,
  mockCreateTemplate,
  mockApplyChanges,
  mockLoadSuite,
  mockRunEval,
  mockFormatReport,
  mockFormatJson,
} = vi.hoisted(() => ({
  mockInitProject: vi.fn(),
  mockCreateTemplate: vi.fn(),
  mockApplyChanges: vi.fn(),
  mockLoadSuite: vi.fn(),
  mockRunEval: vi.fn(),
  mockFormatReport: vi.fn(),
  mockFormatJson: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler-devtool', () => ({
  initProject: mockInitProject,
  createTemplate: mockCreateTemplate,
  applyChanges: mockApplyChanges,
  loadSuite: mockLoadSuite,
  runEval: mockRunEval,
  formatEvalReport: mockFormatReport,
  formatEvalJsonReport: mockFormatJson,
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

    mockInitProject.mockReset();
    mockCreateTemplate.mockReset();
    mockApplyChanges.mockReset();
    mockLoadSuite.mockReset();
    mockRunEval.mockReset();
    mockFormatReport.mockReset();
    mockFormatJson.mockReset();
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  describe('POST /api/devtool/project/init', () => {
    it('initializes project and returns ok', async () => {
      mockInitProject.mockResolvedValue(undefined);

      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/tmp/my-project', type: 'agent' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockInitProject).toHaveBeenCalledWith('/tmp/my-project', { type: 'agent' });
    });

    it('returns 400 when projectDir is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('projectDir and type are required');
    });

    it('returns 400 when type is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/tmp/proj' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('projectDir and type are required');
    });

    it('returns 400 for invalid type', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/tmp/proj', type: 'invalid' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('type must be agent, crew, or skill');
    });

    it('passes noGit option', async () => {
      mockInitProject.mockResolvedValue(undefined);

      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/tmp/proj', type: 'crew', noGit: true }),
      });

      expect(res.ok).toBe(true);
      expect(mockInitProject).toHaveBeenCalledWith('/tmp/proj', {
        type: 'crew',
        noGit: true,
      });
    });
  });

  describe('POST /api/devtool/template', () => {
    it('creates template and returns filePath', async () => {
      mockCreateTemplate.mockResolvedValue('/tmp/proj/agents/test-agent/AGENT.md');

      const res = await fetch(`${getUrl()}/api/devtool/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent', name: 'test-agent', projectDir: '/tmp/proj' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.filePath).toBe('/tmp/proj/agents/test-agent/AGENT.md');
      expect(mockCreateTemplate).toHaveBeenCalledWith('agent', 'test-agent', '/tmp/proj');
    });

    it('returns 400 when type is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', projectDir: '/tmp/proj' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('type, name, and projectDir are required');
    });

    it('returns 400 for invalid type', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'invalid', name: 'test', projectDir: '/tmp/proj' }),
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
        body: JSON.stringify({ changes, projectDir: '/tmp/proj' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.applied).toBe(true);
      expect(mockApplyChanges).toHaveBeenCalledWith(changes, { cwd: '/tmp/proj' });
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

  describe('POST /api/devtool/eval/run', () => {
    const mockSuite = {
      name: 'test',
      target: { type: 'agent', path: '.', skill: null },
      sampling: { runs: 1, passThreshold: 1 },
      cases: [],
    };
    const mockReport = {
      suite: 'test',
      runId: 'r1',
      totalCases: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
    };

    it('runs eval and returns report', async () => {
      mockLoadSuite.mockResolvedValue(mockSuite);
      mockRunEval.mockResolvedValue({ report: mockReport, outputDir: '/tmp/out' });
      mockFormatJson.mockReturnValue('{"suite":"test"}');

      const res = await fetch(`${getUrl()}/api/devtool/eval/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suitePath: 'evals/baseline.yaml' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.report.passed).toBe(1);
      expect(body.outputDir).toBe('/tmp/out');
      expect(mockLoadSuite).toHaveBeenCalledWith('evals/baseline.yaml');
    });

    it('passes runs option', async () => {
      mockLoadSuite.mockResolvedValue(mockSuite);
      mockRunEval.mockResolvedValue({ report: mockReport, outputDir: '/tmp/out' });
      mockFormatJson.mockReturnValue('{}');

      await fetch(`${getUrl()}/api/devtool/eval/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suitePath: 'evals/baseline.yaml', runs: 5 }),
      });

      expect(mockRunEval).toHaveBeenCalledWith(mockSuite, expect.objectContaining({ runs: 5 }));
    });

    it('returns 400 when suitePath is missing', async () => {
      const res = await fetch(`${getUrl()}/api/devtool/eval/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('suitePath is required');
    });
  });

  // Cross-cutting: error handling for file operation routes
  describe('error handling', () => {
    it('POST /api/devtool/project/init returns 500 on failure', async () => {
      mockInitProject.mockRejectedValue(new Error('disk full'));

      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/tmp/proj', type: 'agent' }),
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
        body: JSON.stringify({ type: 'agent', name: 'test', projectDir: '/tmp/proj' }),
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

    it('POST /api/devtool/eval/run returns 500 on failure', async () => {
      mockLoadSuite.mockRejectedValue(new Error('eval crash'));

      const res = await fetch(`${getUrl()}/api/devtool/eval/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suitePath: 'evals/bad.yaml' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('eval crash');
    });

    it('returns Unknown error when thrown value is not an Error', async () => {
      mockInitProject.mockRejectedValue('string error');

      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: '/tmp/proj', type: 'agent' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('Unknown error');
    });
  });
});
