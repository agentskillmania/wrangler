/**
 * @fileoverview Integration: Configuration Management
 *
 * User story: As a developer using skill-studio, I want to read and edit the
 * daemon's configuration, so that I can change LLM and server settings.
 *
 * Behavior contracts under test:
 * - GET /api/config         returns the parsed config object
 * - PATCH /api/config       updates values and persists
 * - GET /api/config/raw     returns the EXACT raw bytes of the daemon config file
 * - PUT /api/config/raw     OVERWRITES the daemon config file with the given content
 *                           (validated as YAML mapping first; on failure returns 400
 *                            and the file MUST remain unchanged)
 *
 * Security contract (SEC6 regression guard):
 * - The raw endpoints accept NO path parameter; they always target the daemon's
 *   own configPath. There is no way to read/write an arbitrary file via these
 *   endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../src/core/config-manager.js';
import { configRoutes } from '../../src/routes/config.js';

const INITIAL_CONFIG =
  "llm:\n  providers:\n    - name: openai\n      apiKey: sk-test-key\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: gpt-4\nserver:\n  port: 3200\n  host: localhost\n";

describe('Integration: Configuration Management', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-config-'));
    configPath = join(tempDir, 'config.yaml');
    await writeFile(configPath, INITIAL_CONFIG);

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

  // ─── GET /api/config (parsed object) ───────────────────────

  it('GET /api/config returns the parsed config object', async () => {
    const res = await fetch(`${getUrl()}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      llm: {
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-test-key',
            baseUrl: 'https://api.example.com',
            models: [{ modelId: 'gpt-4' }],
          },
        ],
      },
      server: { port: 3200, host: 'localhost' },
    });
  });

  // ─── PATCH /api/config ─────────────────────────────────────

  it('PATCH /api/config updates a value and persists to disk', async () => {
    const res = await fetch(`${getUrl()}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: { port: 4200 } }),
    });
    expect(res.status).toBe(200);

    // Returned object reflects the new value
    const body = await res.json();
    expect(body.server.port).toBe(4200);

    // Disk reflects the new value
    const disk = await readFile(configPath, 'utf-8');
    expect(disk).toContain('4200');
  });

  // ─── GET /api/config/raw (exact raw bytes) ─────────────────

  it('GET /api/config/raw returns the EXACT raw content of the daemon config file', async () => {
    const res = await fetch(`${getUrl()}/api/config/raw`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Exact match, not substring — guards against partial/truncated reads
    expect(body.content).toBe(INITIAL_CONFIG);
  });

  // ─── PUT /api/config/raw (overwrite semantics) ─────────────

  it('PUT /api/config/raw OVERWRITES the daemon config file with the submitted content', async () => {
    const newContent =
      'llm:\n  providers:\n    - name: openai\n      apiKey: sk-replaced\n      models:\n        - modelId: gpt-5\nserver:\n  port: 3200\n  host: localhost\n';

    const res = await fetch(`${getUrl()}/api/config/raw`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Exact match — verifies OVERWRITE (not append/merge), the core contract
    const disk = await readFile(configPath, 'utf-8');
    expect(disk).toBe(newContent);
  });

  it('PUT then GET /api/config/raw round-trips the exact content', async () => {
    const newContent =
      'llm:\n  providers:\n    - name: x\n      apiKey: y\n      models:\n        - modelId: z\nserver:\n  port: 3100\n  host: localhost\n';
    const putRes = await fetch(`${getUrl()}/api/config/raw`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await fetch(`${getUrl()}/api/config/raw`);
    const body = await getRes.json();
    expect(body.content).toBe(newContent);
  });

  // ─── PUT /api/config/raw validation (negative paths) ───────

  it('PUT /api/config/raw returns 400 when `content` field is missing', async () => {
    const res = await fetch(`${getUrl()}/api/config/raw`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notContent: 'x' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'content is required' });
  });

  it('PUT /api/config/raw returns 400 for invalid YAML and leaves the file UNCHANGED', async () => {
    const before = await readFile(configPath, 'utf-8');

    const res = await fetch(`${getUrl()}/api/config/raw`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ':\n  bad: : yaml' }),
    });
    expect(res.status).toBe(400);

    // Critical side-effect contract: validation failure must NOT mutate the file
    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('PUT /api/config/raw returns 400 for non-mapping YAML root (array) and leaves the file UNCHANGED', async () => {
    const before = await readFile(configPath, 'utf-8');

    const res = await fetch(`${getUrl()}/api/config/raw`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '- a\n- b\n' }),
    });
    expect(res.status).toBe(400);

    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
  });

  it('PUT /api/config/raw returns 400 for non-mapping YAML root (scalar) and leaves the file UNCHANGED', async () => {
    const before = await readFile(configPath, 'utf-8');

    const res = await fetch(`${getUrl()}/api/config/raw`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'just a string\n' }),
    });
    expect(res.status).toBe(400);

    const after = await readFile(configPath, 'utf-8');
    expect(after).toBe(before);
  });

  // ─── SEC6 regression guard ─────────────────────────────────

  it('GET /api/config/raw accepts NO path parameter (cannot read arbitrary files)', async () => {
    // Plant a sensitive-looking file outside the daemon config
    const secret = join(tempDir, 'secret.txt');
    await writeFile(secret, 'TOPSECRET');

    // The endpoint ignores any path query — it must always return the daemon
    // config, never the secret file.
    const res = await fetch(`${getUrl()}/api/config/raw?path=${encodeURIComponent(secret)}`);
    const body = await res.json();
    expect(body.content).toBe(INITIAL_CONFIG);
    expect(body.content).not.toContain('TOPSECRET');
  });
});
