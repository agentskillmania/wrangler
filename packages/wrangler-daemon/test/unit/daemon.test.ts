import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Daemon } from '../../src/daemon.js';

let tempDir: string;

vi.mock('../../src/constants.js', () => ({
  get APP_DIR() {
    return tempDir;
  },
  get CONFIG_PATH() {
    return join(tempDir, 'config.yaml');
  },
  get AGENTS_DIR() {
    return join(tempDir, 'agents');
  },
  get SKILLS_DIR() {
    return join(tempDir, 'skills');
  },
  get CREWS_DIR() {
    return join(tempDir, 'crews');
  },
  get SESSIONS_DIR() {
    return join(tempDir, 'sessions');
  },
  get PID_PATH() {
    return join(tempDir, 'daemon.pid');
  },
}));

describe('Daemon', () => {
  let daemon: Daemon;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-unit-'));
  });

  afterEach(async () => {
    try {
      await daemon?.shutdown();
    } catch {
      /* ignore shutdown errors */
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('starts up and exposes a listen address', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();
    expect(daemon.address).toMatch(/127\.0\.0\.1:\d+/);
  });

  it('shuts down without throwing', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();
    await expect(daemon.shutdown()).resolves.toBeUndefined();
  });

  it('throws when address is read before startup', () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    expect(() => daemon.address).toThrow('Daemon not started');
  });

  it('serves the playground at /', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Wrangler Daemon Playground');
  });

  it('serves the playground at /playground', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/playground`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Wrangler Daemon Playground');
  });

  it('serves playground.css', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/playground.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('serves js files under /js', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/js/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('returns 404 for missing js file', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/js/missing.js`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('File not found');
  });

  it('returns 400 for js paths containing traversal', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/js/file..traversal`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid path');
  });

  it('serves vendor files under /vendor', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/vendor/preact.module.js`);
    expect(res.status).toBe(200);
  });

  it('returns 404 when playground file is missing', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/missing.html`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for static paths containing traversal', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/vendor/file..traversal`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid path');
  });

  it('returns 404 for missing vendor file', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/vendor/no-such-file.js`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('File not found');
  });

  it('registers API routes and decorates managers', async () => {
    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    // Health route should respond
    const healthRes = await fetch(`http://${daemon.address}/api/health`);
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ status: 'ok' });

    // Resource route should respond (empty list is fine)
    const agentsRes = await fetch(`http://${daemon.address}/api/agents`);
    expect(agentsRes.status).toBe(200);
    expect(await agentsRes.json()).toEqual([]);
  });

  it('discovers an existing session from disk during startup', async () => {
    const { SessionStore } = await import('@agentskillmania/wrangler');
    const { defaultNodeHostEnv } = await import('@agentskillmania/wrangler/host-env/node-host-env');
    const workspacePath = join(tempDir, 'workspace');
    await mkdir(workspacePath, { recursive: true });

    const store = new SessionStore(join(tempDir, 'sessions'), workspacePath, defaultNodeHostEnv);
    await store.createWithId('persisted-session', 'test-agent');

    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/api/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('persisted-session');
  });

  it('loads existing config during startup', async () => {
    await writeFile(
      join(tempDir, 'config.yaml'),
      'llm:\n  providers:\n    - name: openai\n      apiKey: key\n      models:\n        - modelId: custom-model\nserver:\n  port: 3100\n  host: localhost\n'
    );

    daemon = new Daemon({ port: 0, host: '127.0.0.1' });
    await daemon.startup();

    const res = await fetch(`http://${daemon.address}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.llm.providers[0].models[0].modelId).toBe('custom-model');
  });
});
