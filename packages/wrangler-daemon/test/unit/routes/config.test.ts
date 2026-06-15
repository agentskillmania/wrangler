/**
 * @fileoverview Unit tests for config management routes
 *
 * Tests the /api/config endpoints:
 * - GET /api/config — returns current config
 * - PATCH /api/config — updates config values
 * - GET /api/config/file?path=xxx — reads config file
 * - PUT /api/config/file — writes config file
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { configRoutes } from '../../../src/routes/config.js';

describe('Unit: Config Routes', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let configManager: ConfigManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-config-routes-'));

    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      [
        'llm:',
        '  providers:',
        '    - name: openai',
        '      apiKey: sk-test',
        "      baseUrl: 'https://api.example.com'",
        '      models:',
        '        - modelId: test-model',
        'server:',
        '  port: 3100',
        '  host: localhost',
      ].join('\n'),
      'utf-8'
    );

    configManager = new ConfigManager(configPath);
    await configManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    await fastify.register(configRoutes);
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

  // Test 1: GET /api/config returns current config
  it('GET /api/config returns current config', async () => {
    const res = await fetch(`${getUrl()}/api/config`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({
      llm: {
        providers: [
          {
            name: 'openai',
            apiKey: 'sk-test',
            baseUrl: 'https://api.example.com',
            models: [{ modelId: 'test-model' }],
          },
        ],
      },
      server: {
        port: 3100,
        host: 'localhost',
      },
    });
  });

  // Test 2: PATCH /api/config updates config values
  it('PATCH /api/config updates config values', async () => {
    const res = await fetch(`${getUrl()}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: { port: 4200 } }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.server.port).toBe(4200);

    // Verify persisted to disk
    const content = await readFile(join(tempDir, 'config.yaml'), 'utf-8');
    expect(content).toContain('4200');
  });

  // Test 3: GET /api/config/file reads file content
  it('GET /api/config/file reads file content', async () => {
    // Create an extra config file
    const extraPath = join(tempDir, 'extra.yaml');
    await writeFile(extraPath, 'foo: bar\n', 'utf-8');

    const res = await fetch(`${getUrl()}/api/config/file?path=${encodeURIComponent(extraPath)}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.content).toContain('foo: bar');
  });

  // Test 4: GET /api/config/file returns error when path missing
  it('GET /api/config/file returns error when path missing', async () => {
    const res = await fetch(`${getUrl()}/api/config/file`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'path is required' });
  });

  it('GET /api/config/file returns 500 when file is missing', async () => {
    const res = await fetch(
      `${getUrl()}/api/config/file?path=${encodeURIComponent(join(tempDir, 'missing.yaml'))}`
    );
    expect(res.status).toBe(500);
  });

  // Test 5: PUT /api/config/file writes file
  it('PUT /api/config/file writes file', async () => {
    const filePath = join(tempDir, 'written.yaml');

    const res = await fetch(`${getUrl()}/api/config/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: 'baz: qux\n' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Verify file was written
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('baz: qux\n');
  });

  // Test 6: PUT /api/config/file returns error when path or content missing
  it('PUT /api/config/file returns error when path missing', async () => {
    const res = await fetch(`${getUrl()}/api/config/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'data' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'path and content are required' });
  });

  // Test 7: PUT /api/config/file returns error when content missing
  it('PUT /api/config/file returns error when content missing', async () => {
    const res = await fetch(`${getUrl()}/api/config/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/some/path.yaml' }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ error: 'path and content are required' });
  });
});
