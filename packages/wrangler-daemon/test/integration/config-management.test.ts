/**
 * @fileoverview User Story: Configuration Management (Integration)
 *
 * As a developer
 * I want to view and modify daemon configuration
 * So that I can change LLM settings at runtime
 *
 * Acceptance Criteria:
 * 1. GET /api/config returns current config values
 * 2. PATCH /api/config updates config values and persists to disk
 * 3. GET /api/config/file?path= reads an arbitrary config file
 * 4. PUT /api/config/file writes an arbitrary config file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { configRoutes } from '../../src/routes/config.js';

describe('Integration: Configuration Management', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-config-'));

    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  baseUrl: 'https://api.example.com'\n  apiKey: sk-test-key\n  model: gpt-4\nserver:\n  port: 3200\n  host: localhost\n`
    );

    const configManager = new ConfigManager(configPath);
    await configManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.register(configRoutes);
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

  // ─── AC 1: Get config ──────────────────────────────────────

  it('returns current config values', async () => {
    const res = await fetch(`${getUrl()}/api/config`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.llm.model).toBe('gpt-4');
    expect(body.llm.apiKey).toBe('sk-test-key');
    expect(body.server.port).toBe(3200);
  });

  // ─── AC 2: Patch config ────────────────────────────────────

  it('updates config values and persists to disk', async () => {
    const patchRes = await fetch(`${getUrl()}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm: { model: 'gpt-4o' } }),
    });
    expect(patchRes.ok).toBe(true);

    // Verify updated via API
    const getRes = await fetch(`${getUrl()}/api/config`);
    const body = await getRes.json();
    expect(body.llm.model).toBe('gpt-4o');
    // Other values preserved
    expect(body.llm.apiKey).toBe('sk-test-key');

    // Verify persisted to disk
    const diskContent = await readFile(join(tempDir, 'config.yaml'), 'utf-8');
    expect(diskContent).toContain('gpt-4o');
  });

  // ─── AC 3: Read config file ────────────────────────────────

  it('reads an arbitrary config file via path query', async () => {
    // Create a side config file
    await writeFile(join(tempDir, 'mcp.json'), '{"servers": {}}', 'utf-8');

    const res = await fetch(
      `${getUrl()}/api/config/file?path=${encodeURIComponent(join(tempDir, 'mcp.json'))}`
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.content).toContain('servers');
  });

  it('returns error when path is missing', async () => {
    const res = await fetch(`${getUrl()}/api/config/file`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.error).toBe('path is required');
  });

  // ─── AC 4: Write config file ───────────────────────────────

  it('writes content to a config file on disk', async () => {
    const filePath = join(tempDir, 'custom.yaml');

    const writeRes = await fetch(`${getUrl()}/api/config/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: 'key: value\n' }),
    });
    expect(writeRes.ok).toBe(true);

    // Verify file on disk
    const diskContent = await readFile(filePath, 'utf-8');
    expect(diskContent).toBe('key: value\n');
  });

  it('returns error when path or content is missing', async () => {
    const res = await fetch(`${getUrl()}/api/config/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'data' }),
    });
    expect(res.ok).toBe(true);
    expect((await res.json()).error).toBe('path and content are required');
  });

  // ─── Full lifecycle ────────────────────────────────────────

  it('full lifecycle: read config → patch → verify disk → write file → read back', async () => {
    const url = getUrl();

    // 1. Read initial config
    const initial = await (await fetch(`${url}/api/config`)).json();
    expect(initial.llm.model).toBe('gpt-4');

    // 2. Patch model
    await fetch(`${url}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm: { model: 'patched-model' } }),
    });
    const patched = await (await fetch(`${url}/api/config`)).json();
    expect(patched.llm.model).toBe('patched-model');

    // 3. Write a side config file
    const sidePath = join(tempDir, 'side.yaml');
    await fetch(`${url}/api/config/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: sidePath, content: 'side: true\n' }),
    });

    // 4. Read back the side file
    const fileRes = await fetch(`${url}/api/config/file?path=${encodeURIComponent(sidePath)}`);
    const fileBody = await fileRes.json();
    expect(fileBody.content).toContain('side: true');
  });
});
