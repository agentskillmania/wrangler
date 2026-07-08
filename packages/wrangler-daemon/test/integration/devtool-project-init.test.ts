/**
 * @fileoverview User Story: Project Initialization (Integration)
 *
 * As a developer
 * I want to initialize a new wrangler project with a single command
 * So that I get the correct directory structure without manual setup
 *
 * Acceptance Criteria:
 * 1. Specify projectDir and type 'agent', get directory with AGENT.md, skills/, test/, mcp.json, .git/
 * 2. Specify projectDir and type 'crew', get directory with CREW.md, agents/, skills/, test/, .git/
 * 3. Invalid type returns 400
 * 4. Missing projectDir or type returns 400
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { devtoolRoutes } from '../../src/routes/devtool.js';
import { testConfig, itif } from './config.js';

describe('Integration: Project Initialization', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-proj-init-'));
    projectDir = join(tempDir, 'project');

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

  // ─── Validation ────────────────────────────────────────────

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
      body: JSON.stringify({ projectDir }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid type', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir, type: 'invalid' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('type must be');
  });

  // ─── AC 1: Agent type creates full structure ───────────────

  itif(testConfig.enabled)(
    'creates agent project with AGENT.md, skills/, test/, mcp.json, .git/',
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir, type: 'agent' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify files and directories exist on disk
      expect(existsSync(join(projectDir, 'AGENT.md'))).toBe(true);
      expect(existsSync(join(projectDir, 'skills'))).toBe(true);
      expect(existsSync(join(projectDir, 'test'))).toBe(true);
      expect(existsSync(join(projectDir, 'mcp.json'))).toBe(true);
      expect(existsSync(join(projectDir, '.git'))).toBe(true);

      // Verify AGENT.md has valid content
      const agentContent = await readFile(join(projectDir, 'AGENT.md'), 'utf-8');
      expect(agentContent).toContain('---');
      expect(agentContent).toMatch(/^---\nname:/m);
    }
  );

  // ─── AC 2: Crew type creates crew structure ─────────────────

  itif(testConfig.enabled)(
    'creates crew project with CREW.md, agents/, skills/, test/, .git/',
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/project/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir, type: 'crew' }),
      });

      expect(res.ok).toBe(true);

      expect(existsSync(join(projectDir, 'CREW.md'))).toBe(true);
      expect(existsSync(join(projectDir, 'agents'))).toBe(true);
      expect(existsSync(join(projectDir, 'skills'))).toBe(true);
      expect(existsSync(join(projectDir, 'test'))).toBe(true);
      expect(existsSync(join(projectDir, '.git'))).toBe(true);

      const crewContent = await readFile(join(projectDir, 'CREW.md'), 'utf-8');
      expect(crewContent).toContain('---');
    }
  );
});
