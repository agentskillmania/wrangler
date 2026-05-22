/**
 * @fileoverview User Story: File Change Application (Integration)
 *
 * As a developer
 * I want to apply structured file changes to my workspace
 * So that I can create, edit, or delete files in a validated and atomic way
 *
 * Acceptance Criteria:
 * 1. Submit changes array → files are actually created/modified/deleted on disk
 * 2. Path escape attempts (../) are rejected
 * 3. Edit requires matching old content, rejects if not found
 * 4. dryRun mode validates without writing files
 * 5. Empty or missing changes returns 400
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

describe('Integration: File Change Application', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-changes-'));
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

  it('returns 400 when changes is missing', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('changes array is required');
  });

  it('returns 400 when changes is empty', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [] }),
    });

    expect(res.status).toBe(400);
  });

  itif(testConfig.enabled)('creates a new file on disk', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [{ file: 'hello.txt', type: 'create', new: 'hello world' }],
        cwd: workspaceDir,
      }),
    });

    expect(res.ok).toBe(true);
    expect((await res.json()).applied).toBe(true);

    // Verify file exists and has correct content
    const content = await readFile(join(workspaceDir, 'hello.txt'), 'utf-8');
    expect(content).toBe('hello world');
  });

  itif(testConfig.enabled)('edits an existing file on disk', async () => {
    await writeFile(join(workspaceDir, 'edit.txt'), 'old content', 'utf-8');

    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [{ file: 'edit.txt', type: 'edit', old: 'old content', new: 'new content' }],
        cwd: workspaceDir,
      }),
    });

    expect(res.ok).toBe(true);
    const content = await readFile(join(workspaceDir, 'edit.txt'), 'utf-8');
    expect(content).toBe('new content');
  });

  itif(testConfig.enabled)('deletes a file from disk', async () => {
    await writeFile(join(workspaceDir, 'del.txt'), 'bye', 'utf-8');

    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [{ file: 'del.txt', type: 'delete' }],
        cwd: workspaceDir,
      }),
    });

    expect(res.ok).toBe(true);
    expect(existsSync(join(workspaceDir, 'del.txt'))).toBe(false);
  });

  itif(testConfig.enabled)('rejects path escape via ../', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [{ file: '../escaped.txt', type: 'create', new: 'x' }],
        cwd: workspaceDir,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.applied).toBe(false);
    expect(body.error).toContain('escapes workspace');
    expect(existsSync(join(tempDir, 'escaped.txt'))).toBe(false);
  });

  itif(testConfig.enabled)('dryRun validates without writing', async () => {
    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [{ file: 'dry.txt', type: 'create', new: 'dry' }],
        cwd: workspaceDir,
        dryRun: true,
      }),
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.applied).toBe(false);
    expect(body.error).toContain('Dry run');
    expect(existsSync(join(workspaceDir, 'dry.txt'))).toBe(false);
  });

  itif(testConfig.enabled)('applies multiple changes atomically', async () => {
    await writeFile(join(workspaceDir, 'multi.txt'), 'original', 'utf-8');

    const res = await fetch(`${getUrl()}/api/devtool/changes/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changes: [
          { file: 'multi.txt', type: 'edit', old: 'original', new: 'updated' },
          { file: 'extra.txt', type: 'create', new: 'extra content' },
        ],
        cwd: workspaceDir,
      }),
    });

    expect(res.ok).toBe(true);
    expect(await readFile(join(workspaceDir, 'multi.txt'), 'utf-8')).toBe('updated');
    expect(await readFile(join(workspaceDir, 'extra.txt'), 'utf-8')).toBe('extra content');
  });
});
