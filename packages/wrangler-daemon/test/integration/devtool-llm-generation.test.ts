/**
 * @fileoverview User Story: Agent/Skill/Crew Definition Generation (Integration)
 *
 * As a developer
 * I want to generate or modify agent, skill, and crew definitions through natural language
 * So that I can quickly create configurations without writing YAML by hand
 *
 * Acceptance Criteria:
 * 1. Send a prompt and receive a changes array containing file operations and a summary
 * 2. Changes contain valid content with YAML frontmatter (name, description)
 * 3. Can pass existingContent to modify an existing definition
 * 4. Missing prompt returns 400 with clear error message
 *
 * Covers: US-1 (Agent), US-2 (Skill), US-3 (Crew)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { devtoolRoutes } from '../../src/routes/devtool.js';
import { testConfig, itif } from './config.js';

describe('Integration: Definition Generation', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-gen-'));

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

  it('returns 400 when prompt is missing for agent generation', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/agent/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('prompt is required');
  });

  it('returns 400 when prompt is missing for skill generation', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/skill/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when prompt is missing for crew generation', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/crew/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  // ─── US-1: Agent Definition Generation ─────────────────────

  itif(testConfig.enabled)(
    'generates agent definition with changes and summary',
    { timeout: 90_000 },
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/agent/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Create a code review agent that reviews pull requests and provides feedback',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();

      // Validate output structure matches AgentOutput type
      expect(body).toHaveProperty('changes');
      expect(body).toHaveProperty('summary');
      expect(Array.isArray(body.changes)).toBe(true);
      expect(typeof body.summary).toBe('string');
      expect(body.summary.length).toBeGreaterThan(0);

      // Validate changes contain valid agent definition with YAML frontmatter
      expect(body.changes.length).toBeGreaterThan(0);
      const change = body.changes[0];
      expect(change).toHaveProperty('file');
      expect(change).toHaveProperty('new');
      expect(change.new).toMatch(/^---\n/);
      expect(change.new).toContain('name:');
      expect(change.new).toContain('description:');
    }
  );

  // ─── US-2: Skill Definition Generation ─────────────────────

  itif(testConfig.enabled)(
    'generates skill definition with changes and summary',
    { timeout: 60_000 },
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/skill/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Create a web search skill that can search the internet for information',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();

      expect(body).toHaveProperty('changes');
      expect(body).toHaveProperty('summary');
      expect(Array.isArray(body.changes)).toBe(true);
      expect(body.summary.length).toBeGreaterThan(0);

      // Validate changes contain valid skill definition
      expect(body.changes.length).toBeGreaterThan(0);
      const change = body.changes[0];
      expect(change.new).toMatch(/^---\n/);
      expect(change.new).toContain('name:');
    }
  );

  // ─── US-3: Crew Definition Generation ──────────────────────

  itif(testConfig.enabled)(
    'generates crew definition with changes and summary',
    { timeout: 60_000 },
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/crew/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Create a development crew with a coder, a reviewer, and a tester',
        }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();

      expect(body).toHaveProperty('changes');
      expect(body).toHaveProperty('summary');
      expect(Array.isArray(body.changes)).toBe(true);
      expect(body.summary.length).toBeGreaterThan(0);

      // Validate changes contain valid crew definition
      expect(body.changes.length).toBeGreaterThan(0);
      const change = body.changes[0];
      expect(change.new).toMatch(/^---\n/);
      expect(change.new).toContain('name:');
    }
  );
});
