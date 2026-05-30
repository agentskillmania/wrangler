import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { SessionManager } from '../../../src/core/session-manager.js';
import { modelRoutes } from '../../../src/routes/models.js';

describe('Model metadata endpoint', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-models-'));

    // ConfigManager with custom model metadata
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  baseUrl: 'https://api.example.com'\n  apiKey: sk-test\n  model: test-model\n  contextWindow: 128000\n  maxTokens: 8192\n  reasoning: true\nserver:\n  port: 3100\n  host: localhost\n`
    );
    const configManager = new ConfigManager(configPath);
    await configManager.init();

    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    const resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();

    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    fastify.register(modelRoutes);
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

  describe('GET /api/models/:modelId/metadata', () => {
    it('returns metadata for the configured model from YAML config', async () => {
      const res = await fetch(`${getUrl()}/api/models/test-model/metadata`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.modelId).toBe('test-model');
      expect(body.contextWindow).toBe(128000);
      expect(body.maxTokens).toBe(8192);
      expect(body.reasoning).toBe(true);
    });

    it('returns 404 for unknown model', async () => {
      const res = await fetch(`${getUrl()}/api/models/unknown-model/metadata`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });

    it('returns defaults when model has no optional metadata', async () => {
      // Create a config without contextWindow/maxTokens/reasoning
      const configPath2 = join(tempDir, 'config2.yaml');
      await writeFile(
        configPath2,
        `llm:\n  baseUrl: ''\n  apiKey: ''\n  model: bare-model\nserver:\n  port: 3100\n  host: localhost\n`
      );
      const cm2 = new ConfigManager(configPath2);
      await cm2.init();

      const f2 = Fastify();
      const rm2 = new ResourceManager(
        join(tempDir, 'a2'),
        join(tempDir, 's2'),
        join(tempDir, 'c2')
      );
      await rm2.init();
      const sm2 = new SessionManager(join(tempDir, 's2'));
      await sm2.init();

      f2.decorate('configManager', cm2);
      f2.decorate('resourceManager', rm2);
      f2.decorate('sessionManager', sm2);
      f2.register(modelRoutes);
      await f2.listen({ port: 0, host: '127.0.0.1' });

      try {
        const addr = f2.addresses()[0];
        const url = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
        const res = await fetch(`${url}/api/models/bare-model/metadata`);
        expect(res.ok).toBe(true);
        const body = await res.json();
        expect(body.modelId).toBe('bare-model');
        // Defaults when no YAML metadata provided
        expect(body.contextWindow).toBe(0);
        expect(body.maxTokens).toBe(0);
        expect(body.reasoning).toBe(false);
      } finally {
        await f2.close();
      }
    });
  });
});
