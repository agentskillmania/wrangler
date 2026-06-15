/**
 * @fileoverview User Story: Definition Review (Integration)
 *
 * As a developer
 * I want to submit an agent/skill/crew definition file for quality review
 * So that I can identify issues and get improvement suggestions
 *
 * Acceptance Criteria:
 * 1. Submit targetPath and content, receive a review report with overallScore, dimensions, issues, summary
 * 2. overallScore is a number in a valid range (1-10)
 * 3. dimensions contains all five categories (clarity, completeness, focus, safety, efficiency)
 * 4. Each dimension has a numeric score and reasoning text
 * 5. issues is an array with severity, location, description, and suggestion fields
 * 6. Missing targetPath or content returns 400
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { devtoolRoutes } from '../../src/routes/devtool.js';
import { testConfig, itif } from './config.js';

const SAMPLE_AGENT_CONTENT = `---
name: code-reviewer
description: Reviews code for quality and security issues
---

# Code Reviewer

You are a code review agent. Analyze pull request diffs and provide:
1. Security vulnerability assessment
2. Code quality feedback
3. Performance considerations
`;

describe('Integration: Definition Review', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-review-'));

    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: ${testConfig.provider}\n      apiKey: ${testConfig.apiKey}\n${testConfig.baseUrl ? `      baseUrl: '${testConfig.baseUrl}'\n` : ''}      models:\n        - modelId: ${testConfig.testModel}\nserver:\n  port: 3100\n  host: localhost\n`
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
    const res = await fetch(`${getUrl()}/api/devtool/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('targetPath and content are required');
  });

  it('returns 400 when content is missing', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPath: 'AGENT.md' }),
    });

    expect(res.status).toBe(400);
  });

  // ─── AC 1-5: Full review with real LLM ─────────────────────

  itif(testConfig.enabled)(
    'returns review report with all required fields from real LLM',
    { timeout: 60_000 },
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: 'AGENT.md',
          content: SAMPLE_AGENT_CONTENT,
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();

      // AC 1: review report structure
      expect(body).toHaveProperty('overallScore');
      expect(body).toHaveProperty('dimensions');
      expect(body).toHaveProperty('issues');
      expect(body).toHaveProperty('summary');

      // AC 2: overallScore is a number in valid range
      expect(typeof body.overallScore).toBe('number');
      expect(body.overallScore).toBeGreaterThanOrEqual(1);
      expect(body.overallScore).toBeLessThanOrEqual(10);

      // AC 3: dimensions contains all five categories
      const dims = body.dimensions;
      expect(dims).toHaveProperty('clarity');
      expect(dims).toHaveProperty('completeness');
      expect(dims).toHaveProperty('focus');
      expect(dims).toHaveProperty('safety');
      expect(dims).toHaveProperty('efficiency');

      // AC 4: each dimension has numeric score and reasoning
      for (const key of ['clarity', 'completeness', 'focus', 'safety', 'efficiency']) {
        expect(typeof dims[key].score).toBe('number');
        expect(dims[key].score).toBeGreaterThanOrEqual(1);
        expect(dims[key].score).toBeLessThanOrEqual(10);
        expect(typeof dims[key].reasoning).toBe('string');
        expect(dims[key].reasoning.length).toBeGreaterThan(0);
      }

      // AC 5: issues is an array with required fields
      expect(Array.isArray(body.issues)).toBe(true);
      for (const issue of body.issues) {
        expect(issue).toHaveProperty('severity');
        expect(['minor', 'major', 'critical']).toContain(issue.severity);
        expect(issue).toHaveProperty('location');
        expect(issue).toHaveProperty('description');
        expect(issue).toHaveProperty('suggestion');
      }

      // Summary is a non-empty string
      expect(typeof body.summary).toBe('string');
      expect(body.summary.length).toBeGreaterThan(0);
    }
  );

  itif(testConfig.enabled)(
    'accepts optional prompt to focus the review',
    { timeout: 60_000 },
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPath: 'AGENT.md',
          content: SAMPLE_AGENT_CONTENT,
          prompt: 'Focus on security vulnerabilities',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toHaveProperty('overallScore');
      expect(typeof body.overallScore).toBe('number');
    }
  );
});
