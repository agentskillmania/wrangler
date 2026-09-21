/**
 * @fileoverview Unit tests for the launcher identity route.
 *
 * Tests the /api/launcher endpoint (对齐 Rust health.rs 的 LauncherResponse)：
 * - GET /api/launcher — returns daemon identity { name, version, port, host }
 *   （原 agents/skills/sessions 聚合形状随 playground 家族对齐收编——
 *   无消费方）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { launcherRoutes } from '../../../src/routes/launcher.js';

describe('Unit: Launcher Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(launcherRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
  });

  function baseUrl(): string {
    const addr = app.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  it('GET /api/launcher returns the daemon identity', async () => {
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
    // 监听地址回填（127.0.0.1 + 随机端口）。
    expect(body.host).toBe('127.0.0.1');
    expect(body.port).toBeGreaterThan(0);
  });
});
