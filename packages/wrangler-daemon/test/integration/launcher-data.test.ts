/**
 * US-C9: Launcher Data — integration tests.
 *
 * 对齐 Rust health.rs 的 LauncherResponse：/api/launcher 返回 daemon
 * 身份 { name, version, port, host }（原 agents/skills/sessions 聚合
 * 形状随 playground 家族对齐收编——聚合面无消费方，资源列表走各自
 * GET 端点）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';

import { launcherRoutes } from '../../src/routes/launcher.js';

describe('US-C9: Launcher Data', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-launcher-data-'));
    fastify = Fastify();
    await fastify.register(launcherRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await fastify.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function baseUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  it('returns daemon identity with the actual listening address', async () => {
    const res = await fetch(`${baseUrl()}/api/launcher`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      version: string;
      port: number;
      host: string;
    };
    expect(body.name).toBe('wrangler-daemon');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    // 身份信息回填实际监听地址（随机端口的集成测试同样自洽）。
    expect(body.host).toBe('127.0.0.1');
    const addr = fastify.addresses()[0];
    if (typeof addr === 'object') {
      expect(body.port).toBe(addr.port);
    }
  });

  it('is stable across repeated calls (identity is not request-scoped)', async () => {
    const [a, b] = await Promise.all([
      fetch(`${baseUrl()}/api/launcher`).then((r) => r.json()),
      fetch(`${baseUrl()}/api/launcher`).then((r) => r.json()),
    ]);
    expect(a).toEqual(b);
  });
});
