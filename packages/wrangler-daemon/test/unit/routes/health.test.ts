/**
 * @fileoverview Unit tests for health check route
 *
 * Tests the /api/health endpoint:
 * - GET /api/health — returns { status: 'ok' }
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from '../../../src/routes/health.js';

describe('Unit: Health Routes', () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
    fastify.register(healthRoutes);
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
});
