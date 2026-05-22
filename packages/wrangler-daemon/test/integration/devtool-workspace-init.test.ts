/**
 * @fileoverview User Story: Workspace Initialization (Integration)
 *
 * As a developer
 * I want to initialize a new wrangler workspace with a single command
 * So that I get the correct directory structure without manual setup
 *
 * Acceptance Criteria:
 * 1. Specify path and mode 'agent', get directory with AGENT.md, skills/, test/, mcp.json, .git/
 * 2. Specify path and mode 'crew', get directory with CREW.md, agents/, skills/, test/, .git/
 * 3. Specify mode 'bare' with noGit, get minimal structure without .git/
 * 4. Invalid mode returns 400
 * 5. Missing path or mode returns 400
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

describe('Integration: Workspace Initialization', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-ws-init-'));
    workspaceDir = join(tempDir, 'workspace');

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

  // ─── Validation ────────────────────────────────────────────

  it('returns 400 when path is missing', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'agent' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('path and mode are required');
  });

  it('returns 400 when mode is missing', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspaceDir }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid mode', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspaceDir, mode: 'invalid' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('mode must be');
  });

  // ─── AC 1: Agent mode creates full structure ───────────────

  itif(testConfig.enabled)(
    'creates agent workspace with AGENT.md, skills/, test/, mcp.json, .git/',
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workspaceDir, mode: 'agent' }),
      });

      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify files and directories exist on disk
      expect(existsSync(join(workspaceDir, 'AGENT.md'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'skills'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'test'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'mcp.json'))).toBe(true);
      expect(existsSync(join(workspaceDir, '.git'))).toBe(true);

      // Verify AGENT.md has valid content
      const agentContent = await readFile(join(workspaceDir, 'AGENT.md'), 'utf-8');
      expect(agentContent).toContain('---');
      expect(agentContent).toMatch(/^---\nname:/m);
    }
  );

  // ─── AC 2: Crew mode creates crew structure ─────────────────

  itif(testConfig.enabled)(
    'creates crew workspace with CREW.md, agents/, skills/, test/, .git/',
    async () => {
      const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workspaceDir, mode: 'crew' }),
      });

      expect(res.ok).toBe(true);

      expect(existsSync(join(workspaceDir, 'CREW.md'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'agents'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'skills'))).toBe(true);
      expect(existsSync(join(workspaceDir, 'test'))).toBe(true);
      expect(existsSync(join(workspaceDir, '.git'))).toBe(true);

      const crewContent = await readFile(join(workspaceDir, 'CREW.md'), 'utf-8');
      expect(crewContent).toContain('---');
    }
  );

  // ─── AC 3: Bare mode with noGit skips .git ─────────────────

  itif(testConfig.enabled)('creates bare workspace without .git when noGit is true', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/workspace/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: workspaceDir, mode: 'bare', noGit: true }),
    });

    expect(res.ok).toBe(true);

    expect(existsSync(join(workspaceDir, 'skills'))).toBe(true);
    expect(existsSync(join(workspaceDir, '.git'))).toBe(false);
  });
});
