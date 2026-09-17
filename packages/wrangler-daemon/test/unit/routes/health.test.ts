/**
 * @fileoverview Unit tests for health check route
 *
 * Tests the /api/health endpoint:
 * - GET /api/health — returns { status: 'ok' }
 * Tests the /api/env endpoint (R2P-233, aligned Rust c66ff2d):
 * - GET /api/env — read-only environment introspection; field set pinned to
 *   the Rust daemon's (dirs + version + cwd), no credentials in the payload.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from '../../../src/routes/health.js';

describe('Unit: Health Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(healthRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
  });

  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  // Test 1: GET /api/health returns ok
  it('GET /api/health returns { status: "ok" }', async () => {
    const res = await fetch(`${getUrl()}/api/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  // Test 2: GET /api/env — 环境自省字段集与 Rust c66ff2d 对齐（R2P-233）
  it('GET /api/env returns the introspection field set (dirs, version, cwd — no credentials)', async () => {
    const res = await fetch(`${getUrl()}/api/env`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;

    // 字段集逐一对齐 Rust env_info：version/appDir/appDirSource/configPath/
    // agentsDir/skillsDir/crewsDir/sessionsDir/pidPath/daemonCwd/specPlanNote。
    expect(Object.keys(body).sort()).toEqual(
      [
        'version',
        'appDir',
        'appDirSource',
        'configPath',
        'agentsDir',
        'skillsDir',
        'crewsDir',
        'sessionsDir',
        'pidPath',
        'daemonCwd',
        'specPlanNote',
      ].sort()
    );

    // 解析来源二值：env 覆盖或默认（测试进程通常未设 → default）。
    expect(['env:AGENTSKILLMANIA_APP_DIR', 'default:~/.agentskillmania/skill-studio']).toContain(
      body.appDirSource
    );
    // 路径形状：目录字段都在 appDir 之下、config.yaml/pid 是文件路径。
    expect(String(body.agentsDir).startsWith(String(body.appDir))).toBe(true);
    expect(String(body.configPath).endsWith('config.yaml')).toBe(true);
    expect(String(body.pidPath).endsWith('daemon.pid')).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.version).not.toBe('');
  });
});
