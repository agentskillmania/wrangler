/**
 * @fileoverview GET /api/chat/:sessionId 诊断快照路由测试（对齐 Rust
 * 65732f3 的 chat_diagnostics；原 /api/agent/:id/state 常驻流退役）。
 *
 * - 温会话：AgentSession.getDiagnostics() 实时快照原样透出
 * - 冷会话：state.json + meta.yaml 降级快照（llm/systemPrompt 置空，
 *   quiet 恒真——盘上无在飞轮）
 * - 都没有 → 404
 * - 显式 sessionDir 优先寻址（笔记目录即会话）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { chatRoutes } from '../../../src/routes/chat.js';
import { SessionManager } from '../../../src/core/session-manager.js';
import { SessionStore } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';

describe('GET /api/chat/:sessionId diagnostics (R2P-153 onetake 家族)', () => {
  let fastify: FastifyInstance;
  let tempDir: string;
  let sessionManager: SessionManager;
  let workspacePath: string;

  const mockDiagnostics = {
    runner: { features: { sandbox: false }, tools: [], skills: [] },
    agent: { id: 'warm', config: { name: 'a' }, context: { messages: [] } },
    llm: null,
    systemPrompt: null,
    quiet: true,
    quietBlockers: [],
    session: { overview: { sessionId: 'warm' }, info: { sessionId: 'warm' } },
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-chat-diag-'));
    workspacePath = join(tempDir, 'workspace');

    const sessionsDir = join(tempDir, 'sessions');
    sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    fastify = Fastify();
    fastify.decorate('sessionManager', sessionManager);
    await fastify.register(chatRoutes);
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

  async function createSessionOnDisk(sessionId: string): Promise<void> {
    const store = sessionManager.getSessionStore(workspacePath);
    await store.createWithId(sessionId, 'test-agent');
    await store.updateMeta(sessionId, {
      runnerConfig: { model: 'm1', sandbox: false },
      workspacePath,
    } as never);
    sessionManager.registerSession(sessionId, workspacePath);
  }

  it('404 when the session is neither warm nor on disk', async () => {
    const res = await fetch(`${getUrl()}/api/chat/nonexistent`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('Session not found');
  });

  it('warm session returns the live diagnostics payload', async () => {
    const getDiagnostics = vi.fn().mockResolvedValue(mockDiagnostics);
    sessionManager.setAgentSession('warm-id', { getDiagnostics } as never);

    const res = await fetch(`${getUrl()}/api/chat/warm-id`);
    expect(res.status).toBe(200);
    expect(getDiagnostics).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual(mockDiagnostics);
  });

  it('cold session returns a degraded snapshot from disk', async () => {
    await createSessionOnDisk('cold-id');

    const res = await fetch(`${getUrl()}/api/chat/cold-id`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runner: { features: Record<string, unknown> };
      llm: unknown;
      systemPrompt: unknown;
      quiet: boolean;
      quietBlockers: unknown[];
      session: { overview: Record<string, unknown>; info: Record<string, unknown> };
    };
    // 降级面：无 LLM 追踪、无在飞轮
    expect(body.llm).toBeNull();
    expect(body.systemPrompt).toBeNull();
    expect(body.quiet).toBe(true);
    expect(body.quietBlockers).toEqual([]);
    expect(body.session.overview.model).toBe('m1');
    expect(body.session.overview.status).toBe('idle');
    expect(body.session.info.sessionId).toBe('cold-id');
    expect(body.runner.features).toBeDefined();
  });

  it('explicit sessionDir addressing wins over the standard tree', async () => {
    // 笔记目录即会话：目录绑定 store（meta 有身份即可寻址）。
    const notebook = join(tempDir, 'notebook');
    const dirStore = SessionStore.fromDir(notebook, defaultNodeHostEnv);
    await dirStore.createWithId(undefined, 'dirbound-agent');
    await dirStore.updateMeta(undefined, { runnerConfig: { model: 'dirbound' } } as never);

    const res = await fetch(
      `${getUrl()}/api/chat/any-id?sessionDir=${encodeURIComponent(notebook)}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { overview: Record<string, unknown> } };
    expect(body.session.overview.model).toBe('dirbound');
  });
});
