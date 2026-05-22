/**
 * @fileoverview User Story: Test Execution (Integration)
 *
 * As a developer
 * I want to run test cases against my agent or crew definitions
 * So that I can verify they behave correctly
 *
 * Acceptance Criteria:
 * 1. Specify targetPath and receive a test report with total, passed, failed counts and results
 * 2. Can filter by specific test case name via the case parameter
 * 3. Can run only hard tests via hardOnly parameter
 * 4. Missing targetPath returns 400
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { devtoolRoutes } from '../../src/routes/devtool.js';
import { testConfig, itif } from './config.js';

describe('Integration: Test Execution', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-test-exec-'));
    workspaceDir = join(tempDir, 'workspace');
    await mkdir(workspaceDir, { recursive: true });

    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  baseUrl: '${testConfig.baseUrl || ''}'\n  apiKey: ${testConfig.apiKey}\n  model: ${testConfig.testModel}\nserver:\n  port: 3100\n  host: localhost\n`
    );

    const configManager = new ConfigManager(configPath);
    await configManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.register(devtoolRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  // ─── Validation (no LLM needed) ────────────────────────────

  it('returns 400 when targetPath is missing', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('targetPath is required');
  });

  // ─── AC 1: Returns valid report structure ──────────────────

  itif(testConfig.enabled)(
    'returns test report with summary and suites for agent workspace',
    async () => {
      // Create a minimal agent workspace with a test case
      await writeFile(
        join(workspaceDir, 'AGENT.md'),
        `---\nname: test-agent\ndescription: A minimal test agent\n---\n\n# Test Agent\n\nYou are a test assistant. Always respond with exactly: "pong"\n`
      );

      await mkdir(join(workspaceDir, 'test'), { recursive: true });
      await writeFile(
        join(workspaceDir, 'test', 'basic.yaml'),
        `name: basic-ping\ndescription: Agent should respond to ping\ninput:\n  message: "ping"\nexpected:\n  hard:\n    - type: output_contains\n      value: "pong"\n`
      );

      const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPath: workspaceDir }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();

      // Validate report structure
      expect(body).toHaveProperty('suites');
      expect(body).toHaveProperty('summary');
      expect(Array.isArray(body.suites)).toBe(true);

      // Validate summary
      const summary = body.summary;
      expect(summary).toHaveProperty('total');
      expect(summary).toHaveProperty('passed');
      expect(summary).toHaveProperty('failed');
      expect(summary).toHaveProperty('duration');
      expect(summary).toHaveProperty('hardPassed');
      expect(summary).toHaveProperty('hardFailed');
      expect(typeof summary.total).toBe('number');
      expect(typeof summary.passed).toBe('number');
      expect(typeof summary.failed).toBe('number');
      expect(typeof summary.duration).toBe('number');
      expect(summary.total).toBeGreaterThan(0);

      // Validate suite structure
      const suite = body.suites[0];
      expect(suite).toHaveProperty('file');
      expect(suite).toHaveProperty('cases');
      expect(suite).toHaveProperty('passed');
      expect(Array.isArray(suite.cases)).toBe(true);
      expect(suite.cases.length).toBeGreaterThan(0);

      // Validate case result structure
      const caseResult = suite.cases[0];
      expect(caseResult).toHaveProperty('case');
      expect(caseResult).toHaveProperty('passed');
      expect(caseResult).toHaveProperty('duration');
      expect(caseResult).toHaveProperty('hardResults');
      expect(typeof caseResult.passed).toBe('boolean');
      expect(typeof caseResult.duration).toBe('number');
      expect(Array.isArray(caseResult.hardResults)).toBe(true);

      // Validate hard result structure
      const hardResult = caseResult.hardResults[0];
      expect(hardResult).toHaveProperty('passed');
      expect(hardResult).toHaveProperty('message');
      expect(typeof hardResult.passed).toBe('boolean');
    }
  );

  // ─── AC 2: Filter by case name ─────────────────────────────

  itif(testConfig.enabled)('filters test cases by name via case parameter', async () => {
    // Create agent workspace with two test case files
    await writeFile(
      join(workspaceDir, 'AGENT.md'),
      `---\nname: filter-agent\ndescription: A test agent\n---\n\n# Filter Agent\n\nRespond with hello\n`
    );

    await mkdir(join(workspaceDir, 'test'), { recursive: true });
    await writeFile(
      join(workspaceDir, 'test', 'alpha.yaml'),
      `name: case-alpha\ndescription: First case\ninput:\n  message: test alpha\nexpected:\n  hard:\n    - type: output_contains\n      value: hello\n`
    );
    await writeFile(
      join(workspaceDir, 'test', 'beta.yaml'),
      `name: case-beta\ndescription: Second case\ninput:\n  message: test beta\nexpected:\n  hard:\n    - type: output_contains\n      value: hello\n`
    );

    // Run only case-alpha
    const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath: workspaceDir, case: 'case-alpha' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    // Should only run one case
    expect(body.summary.total).toBe(1);
    expect(body.suites[0].cases.length).toBe(1);
    expect(body.suites[0].cases[0].case.name).toBe('case-alpha');
  });

  // ─── AC 3: hardOnly mode ───────────────────────────────────

  itif(testConfig.enabled)('runs only hard assertions when hardOnly is true', async () => {
    await writeFile(
      join(workspaceDir, 'AGENT.md'),
      `---\nname: hardonly-agent\ndescription: A test agent\n---\n\n# HardOnly Agent\n\nRespond with "ok"\n`
    );

    await mkdir(join(workspaceDir, 'test'), { recursive: true });
    await writeFile(
      join(workspaceDir, 'test', 'soft.yaml'),
      `name: soft-case\ndescription: Case with soft assertions\ninput:\n  message: "test"\nexpected:\n  hard:\n    - type: output_contains\n      value: "ok"\n  soft:\n    - name: tone-check\n      criteria: Response should be polite\n      rubric:\n        - score: 5\n          description: Very polite\n        - score: 1\n          description: Not polite\n      minScore: 3\n`
    );

    const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath: workspaceDir, hardOnly: true }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.summary.total).toBe(1);

    // With hardOnly, soft assertions should not be evaluated
    const caseResult = body.suites[0].cases[0];
    expect(caseResult.softResults).toBeUndefined();
  });

  // ─── Empty report when no test cases ───────────────────────

  itif(testConfig.enabled)('returns empty report when workspace has no test cases', async () => {
    // Create agent workspace without test directory
    await writeFile(
      join(workspaceDir, 'AGENT.md'),
      `---\nname: no-tests-agent\ndescription: Agent without tests\n---\n\n# No Tests Agent\n\nHello\n`
    );

    const res = await fetch(`${getUrl()}/api/devtool/test/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath: workspaceDir }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();

    expect(body.summary.total).toBe(0);
    expect(body.summary.passed).toBe(0);
    expect(body.summary.failed).toBe(0);
    expect(body.suites).toEqual([]);
  });
});
