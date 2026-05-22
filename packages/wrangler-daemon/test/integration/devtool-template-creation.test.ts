/**
 * @fileoverview User Story: Template File Creation (Integration)
 *
 * As a developer
 * I want to create a template file for a new agent/skill/crew/session
 * So that I have a correct starting point with proper YAML frontmatter
 *
 * Acceptance Criteria:
 * 1. Specify type, name, cwd → file created at returned filePath
 * 2. File content starts with YAML frontmatter containing the specified name
 * 3. Invalid type returns 400
 * 4. Missing required fields returns 400
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { devtoolRoutes } from '../../src/routes/devtool.js';
import { testConfig, itif } from './config.js';

describe('Integration: Template File Creation', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-template-'));
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

  it('returns 400 when type is missing', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test', cwd: workspaceDir }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('type, name, and cwd are required');
  });

  it('returns 400 for invalid type', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invalid', name: 'test', cwd: workspaceDir }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('type must be');
  });

  itif(testConfig.enabled)('creates agent template with correct YAML frontmatter', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'agent', name: 'my-bot', cwd: workspaceDir }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.filePath).toBeTruthy();

    // Verify file exists on disk
    expect(existsSync(body.filePath)).toBe(true);

    // Verify content has correct frontmatter with name
    const content = await readFile(body.filePath, 'utf-8');
    expect(content).toMatch(/^---\nname: my-bot\n/);
    expect(content).toContain('description:');
  });

  itif(testConfig.enabled)('creates skill template with correct YAML frontmatter', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'skill', name: 'search-web', cwd: workspaceDir }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    const content = await readFile(body.filePath, 'utf-8');
    expect(content).toMatch(/^---\nname: search-web\n/);
  });

  itif(testConfig.enabled)('creates crew template with correct YAML frontmatter', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'crew', name: 'dev-team', cwd: workspaceDir }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    const content = await readFile(body.filePath, 'utf-8');
    expect(content).toMatch(/^---\nname: dev-team\n/);
  });
});
