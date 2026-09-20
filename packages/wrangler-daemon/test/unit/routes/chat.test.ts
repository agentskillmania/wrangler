import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { ConfigManager } from '../../../src/core/config-manager.js';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { SessionNotFoundError, writeMeta } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import { SessionManager } from '../../../src/core/session-manager.js';
import { chatRoutes } from '../../../src/routes/chat.js';

// ─── Mock setup ───

const { mockAgentSessionCreate, mockAgentSessionResume, mockHandleMessage, mockTruncateTurns } =
  vi.hoisted(() => ({
    mockAgentSessionCreate: vi.fn(),
    mockAgentSessionResume: vi.fn(),
    mockHandleMessage: vi.fn(),
    mockTruncateTurns: vi.fn(),
  }));

vi.mock('../../../src/core/agent-session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/agent-session.js')>();
  return {
    ...actual,
    AgentSession: {
      create: mockAgentSessionCreate,
      resume: mockAgentSessionResume,
    },
  };
});

/** Shared mock session instance reused across SSE streaming tests. */
const mockRunnerConfig = {
  model: 'test-model',
  contextWindow: 128000,
  thinkingEnabled: false,
  enablePromptThinking: false,
  sandbox: false,
  compressorEnabled: false,
  enableSession: false,
  enableTodolist: false,
  enableSpecPlan: false,
  enableCommands: false,
  a2ui: { enabled: false },
  skillDirs: [],
  mcpConfigPaths: [],
};

const mockSession = {
  sessionId: 'mock-session-123',
  busy: false,
  handleMessage: mockHandleMessage,
  sendMessageInBackground: vi.fn().mockReturnValue({
    ok: true,
    turnSeq: 1,
    completion: Promise.resolve({ hadError: false }),
  }),
  continueRun: vi.fn(),
  continueRunInBackground: vi.fn(),
  respondViaState: vi.fn(),
  stop: vi.fn(),
  respondHumanInput: vi.fn(),
  emitCockpitEvent: vi.fn(),
  // /truncate 的温会话路径（busy 闩锁临界区内读盘→截断→写盘→重载）。
  truncateTurns: mockTruncateTurns,
  // The chat route reads `agentSession.getRunnerConfig()` (new accessor) to
  // build the `session-start` SSE payload (chat.ts streamAgentSession).
  // Without this the route throws synchronously after hijacking the reply,
  // leaving the SSE connection open and the test to deadlock on `await fetch(...)`.
  getRunnerConfig: () => mockRunnerConfig,
  runner: {
    getConfig: () => mockRunnerConfig,
  },
};

// ─── SSE parsing helper ───

interface ParsedSSE {
  event: string;
  data: unknown;
}

function parseSSE(raw: string): ParsedSSE[] {
  const results: ParsedSSE[] = [];
  const chunks = raw.split('\n\n').filter((c) => c.trim());
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data = line.slice(6);
    }
    if (event) {
      results.push({ event, data: data ? JSON.parse(data) : {} });
    }
  }
  return results;
}

// ─── Tests ───

describe('Chat API', () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-chat-'));

    // ConfigManager
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: test-model\nserver:\n  port: 3100\n  host: localhost\n`
    );
    const configManager = new ConfigManager(configPath);
    await configManager.init();

    // ResourceManager with a test agent
    const agentsDir = join(tempDir, 'agents');
    const skillsDir = join(tempDir, 'skills');
    const crewsDir = join(tempDir, 'crews');
    const resourceManager = new ResourceManager(agentsDir, skillsDir, crewsDir);
    await resourceManager.init();
    await resourceManager.createAgent({ name: 'test-agent', instructions: 'test instructions' });

    // SessionManager
    const sessionsDir = join(tempDir, 'sessions');
    const sessionManager = new SessionManager(sessionsDir);
    await sessionManager.init();

    // Create a session on disk for resume / history tests
    const store = sessionManager.getSessionStore(join(tempDir, 'workspace'));
    await store.createWithId('existing-session', 'test-agent');
    await store.updateMeta('existing-session', { runnerConfig: { model: 'test-model' } });
    sessionManager.registerSession('existing-session', join(tempDir, 'workspace'));

    // Fastify with decorators
    fastify = Fastify();
    fastify.decorate('configManager', configManager);
    fastify.decorate('resourceManager', resourceManager);
    fastify.decorate('sessionManager', sessionManager);
    await fastify.register(chatRoutes);
    await fastify.listen({ port: 0, host: '127.0.0.1' });

    mockAgentSessionCreate.mockClear();
    mockAgentSessionResume.mockClear();
    mockHandleMessage.mockClear();
    mockSession.stop.mockClear();
    mockSession.respondHumanInput.mockClear();
    mockSession.respondViaState.mockClear();
    mockSession.continueRun.mockClear();
    mockSession.emitCockpitEvent.mockClear();
    mockTruncateTurns.mockReset();
  });

  afterEach(async () => {
    // Bound the close so an SSE response whose body a test forgot to drain
    // (or an aborted client the server hasn't reaped) can't deadlock teardown.
    // Tests SHOULD drain their SSE bodies; this guard just keeps a miss from
    // hanging the whole suite for the 30s default close timeout.
    await Promise.race([fastify.close(), new Promise((r) => setTimeout(r, 1500))]);
    await rm(tempDir, { recursive: true, force: true });
  });

  /** Resolve the random port assigned by Fastify. */
  function getUrl(): string {
    const addr = fastify.addresses()[0];
    return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
  }

  // ─── GET /api/chat/commands ───

  describe('GET /api/chat/commands', () => {
    it('returns predefined commands array', async () => {
      const res = await fetch(`${getUrl()}/api/chat/commands`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      // Verify expected command IDs are present
      const ids = body.map((c: { id: string }) => c.id);
      expect(ids).toContain('search');
      expect(ids).toContain('file');
      expect(ids).toContain('shell');
      expect(ids).toContain('todo');
      expect(ids).toContain('ask');
      expect(ids).toContain('think');

      // Verify each command has required fields
      for (const cmd of body as Array<Record<string, string>>) {
        expect(cmd).toHaveProperty('id');
        expect(cmd).toHaveProperty('label');
        expect(cmd).toHaveProperty('command');
        expect(cmd).toHaveProperty('group');
        expect(cmd).toHaveProperty('description');
      }
    });
  });

  // ─── GET /api/chat/:sessionId/messages ───

  describe('GET /api/chat/:sessionId/messages', () => {
    it('returns message history for existing session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toHaveProperty('messages');
      expect(Array.isArray(body.messages)).toBe(true);
    });

    it('returns empty messages for non-existent session (standard tree, 200)', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.messages).toEqual([]);
    });

    // ─── todo 快照透传（R2P-237，对齐 Rust 9b0c46d/dfa2105）───
    // TS 侧 todo 存 state.context.todoList（todo-middleware immer 写入），
    // messages 返回体透传该字段——resume 后前端 todo 卡的数据源。
    // 旧档缺键省略（前端按缺席降级），不断言 undefined 键存在。

    it('passes context.todoList through when present (standard tree)', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.saveState('existing-session', {
        id: 'existing-session',
        config: { name: 'test-agent', instructions: '', tools: [] },
        context: {
          messages: [],
          stepCount: 0,
          createdAt: 0,
          updatedAt: 0,
          todoList: { items: [{ id: 1, subject: 'task one', status: 'in_progress' }], nextId: 2 },
        },
      } as never);

      const res = await fetch(`${getUrl()}/api/chat/existing-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.todoList).toEqual({
        items: [{ id: 1, subject: 'task one', status: 'in_progress' }],
        nextId: 2,
      });
    });

    it('omits the todoList key when the state has none (old archives)', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/messages`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect('todoList' in body).toBe(false);
    });

    it('passes todoList through for explicit sessionDir reads', async () => {
      const dir = join(tempDir, 'notebook-state');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'state.json'),
        JSON.stringify({
          context: { messages: [], todoList: { items: [], nextId: 1 } },
        })
      );

      const res = await fetch(
        `${getUrl()}/api/chat/notebook/messages?sessionDir=${encodeURIComponent(dir)}`
      );
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.todoList).toEqual({ items: [], nextId: 1 });
    });

    it('omits todoList for explicit sessionDir state without one', async () => {
      const dir = join(tempDir, 'notebook-state-bare');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'state.json'), JSON.stringify({ context: { messages: [] } }));

      const res = await fetch(
        `${getUrl()}/api/chat/notebook/messages?sessionDir=${encodeURIComponent(dir)}`
      );
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect('todoList' in body).toBe(false);
    });
  });

  // ─── POST /api/chat/:sessionId/stop ───

  describe('POST /api/chat/:sessionId/stop', () => {
    it('stops active agent session', async () => {
      // Register an active agent session so stop() is called
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);

      const res = await fetch(`${getUrl()}/api/chat/existing-session/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockSession.stop).toHaveBeenCalledTimes(1);
    });

    it('returns ok when no active session', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/stop`, { method: 'POST' });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // stop should NOT have been called since there was no active session
      expect(mockSession.stop).not.toHaveBeenCalled();
    });
  });

  // ─── POST /api/chat/:sessionId/truncate（R2P-154a，对齐 Rust 0a2cc4e）───

  describe('explicit sessionDir bound to a different warm sessionId → 400 (R2P-161b③)', () => {
    it('rejects the mismatched id instead of bypassing the session mutex', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.registerSession('real-id', join(tempDir, 'workspace'));
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.createWithId('real-id', 'test-agent');
      // 温会话：dir-binding 检查只扫温会话注册表（getAllAgentSessions）
      sm.setAgentSession('real-id', {
        busy: false,
        stop: () => {},
        handleMessage: async function* () {},
      } as never);
      const boundDir = store.getSessionDir('real-id');

      const res = await fetch(`${getUrl()}/api/chat/wrong-id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hi', sessionDir: boundDir }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(String(body.error)).toContain("bound to sessionId 'real-id'");
    });
  });

  describe('POST /api/sessions/:id/truncate (resource-face alias, P3 Task 9)', () => {
    it('serves the same handler as the chat-face path', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.registerSession('alias-sess', join(tempDir, 'workspace'));
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.createWithId('alias-sess', 'test-agent');
      await store.saveState('alias-sess', {
        id: 'alias-sess',
        config: { name: 'test-agent', instructions: '', tools: [] },
        context: {
          messages: [
            { role: 'user', content: 'a', timestamp: 0 },
            { role: 'assistant', content: 'b', timestamp: 0 },
          ],
          stepCount: 1,
        },
      });

      const res = await fetch(`${getUrl()}/api/sessions/alias-sess/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepTurns: 0 }),
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, kept: 0 });
    });
  });

  describe('POST /api/chat/:sessionId/truncate', () => {
    /** Seed a 3-turn state (+todoList/统计字段) on the standard tree. */
    async function seedTurns(sessionId = 'existing-session'): Promise<void> {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.saveState(sessionId, {
        id: sessionId,
        config: { name: 'test-agent', instructions: '', tools: [] },
        usage: { totalTokens: 12345 },
        context: {
          messages: [
            { role: 'user', content: 'u1' },
            { role: 'assistant', content: 'a1' },
            { role: 'tool', content: 't1' },
            { role: 'user', content: 'u2' },
            { role: 'assistant', content: 'a2' },
            { role: 'user', content: 'u3' },
          ],
          stepCount: 7,
          totalTokens: { input: 99, output: 5 },
          todoList: { items: [{ id: 1, subject: 'task', status: 'pending' }], nextId: 2 },
        },
      } as never);
    }

    function statePathOnDisk(sessionId = 'existing-session'): string {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      return join(store.getSessionDir(sessionId), 'state.json');
    }

    async function readRawState(sessionId = 'existing-session'): Promise<Record<string, never>> {
      return JSON.parse(await readFile(statePathOnDisk(sessionId), 'utf-8')) as Record<
        string,
        never
      >;
    }

    function postTruncate(keepTurns: unknown, sessionId = 'existing-session'): Promise<Response> {
      return fetch(`${getUrl()}/api/chat/${sessionId}/truncate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepTurns }),
      });
    }

    it('rejects a non-integer / negative / missing keepTurns with 400', async () => {
      for (const bad of [undefined, -1, 1.5, '2']) {
        const res = await postTruncate(bad);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('keepTurns must be a non-negative integer');
      }
    });

    it('explicit sessionDir without state.json is a hard 404', async () => {
      const res = await fetch(
        `${getUrl()}/api/chat/whatever/truncate?sessionDir=${encodeURIComponent(join(tempDir, 'no-state-dir'))}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepTurns: 1 }),
        }
      );
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Session state not found');
    });

    it('unknown session on the standard tree is 404', async () => {
      const res = await postTruncate(1, 'no-such-session');
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Session not found');
    });

    it('cold path truncates on disk: turn = user opener + trailing tool/assistant', async () => {
      await seedTurns();
      const res = await postTruncate(1);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, kept: 1 });

      const v = await readRawState();
      const ctx = v.context as unknown as {
        messages: Array<{ role: string; content: string }>;
        todoList?: unknown;
        totalTokens: { input: number; output: number };
        stepCount: number;
      };
      // 轮 = user 开启,tool/assistant 尾随随轮保留;后两轮被丢弃。
      expect(ctx.messages.map((m) => m.content)).toEqual(['u1', 'a1', 't1']);
      // todoList 随截断删键(前端按缺席降级)。
      expect('todoList' in ctx).toBe(false);
      // 统计/计费字段永不动。
      expect(ctx.totalTokens).toEqual({ input: 99, output: 5 });
      expect(ctx.stepCount).toBe(7);
      expect(v.usage).toEqual({ totalTokens: 12345 });
    });

    it('keepTurns beyond total turns is a clamped no-op for messages', async () => {
      await seedTurns();
      const res = await postTruncate(99);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, kept: 3 });
      const v = await readRawState();
      const messages = (v.context as unknown as { messages: unknown[] }).messages;
      expect(messages).toHaveLength(6);
    });

    it('applying the same keepTurns twice is idempotent (byte-equal state)', async () => {
      await seedTurns();
      await postTruncate(2);
      const first = await readFile(statePathOnDisk(), 'utf-8');
      const res = await postTruncate(2);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, kept: 2 });
      const second = await readFile(statePathOnDisk(), 'utf-8');
      expect(second).toBe(first);
    });

    it('keepTurns=0 clears messages and the emptied state still loads via loadState (空会话 resume 往返)', async () => {
      await seedTurns();
      const res = await postTruncate(0);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, kept: 0 });

      // 磁盘:messages 清空,todoList 删键,统计不动。
      const v = await readRawState();
      const ctx = v.context as unknown as {
        messages: unknown[];
        todoList?: unknown;
        totalTokens: { input: number };
      };
      expect(ctx.messages).toEqual([]);
      expect('todoList' in ctx).toBe(false);
      expect(ctx.totalTokens.input).toBe(99);

      // 往返:SessionStore.loadState 可恢复(截空后的 state 依然是合法
      // AgentState——编辑/重发首轮的空会话 resume 通路)。
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      const reloaded = await store.loadState('existing-session');
      expect(reloaded).not.toBeNull();
      expect(reloaded!.context.messages).toEqual([]);
    });

    it('truncates the explicit sessionDir state.json (notebook-dir addressing)', async () => {
      const dir = join(tempDir, 'notebook-state');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'state.json'),
        JSON.stringify({
          context: {
            messages: [
              { role: 'user', content: 'u1' },
              { role: 'assistant', content: 'a1' },
              { role: 'user', content: 'u2' },
            ],
          },
        })
      );

      const res = await fetch(
        `${getUrl()}/api/chat/notebook/truncate?sessionDir=${encodeURIComponent(dir)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepTurns: 1 }),
        }
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, kept: 1 });
      const v = JSON.parse(await readFile(join(dir, 'state.json'), 'utf-8')) as {
        context: { messages: Array<{ content: string }> };
      };
      expect(v.context.messages.map((m) => m.content)).toEqual(['u1', 'a1']);
    });

    it('corrupt state.json is 500 and the file is NOT overwritten', async () => {
      await seedTurns();
      await writeFile(statePathOnDisk(), 'not json', 'utf-8');
      const res = await postTruncate(1);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toContain('truncate failed');
      expect(await readFile(statePathOnDisk(), 'utf-8')).toBe('not json');
    });

    it('warm busy session → 409 with busy triage fields', async () => {
      await seedTurns();
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.busy = true;
      try {
        const res = await postTruncate(1);
        expect(res.status).toBe(409);
        const body = await res.json();
        // 向后兼容保留原 error;分诊字段说清在等什么。
        expect(body.error).toBe('Session is busy');
        expect(body.reason).toBe('busy');
        expect(typeof body.detail).toBe('string');
        expect(mockTruncateTurns).not.toHaveBeenCalled();
      } finally {
        mockSession.busy = false;
      }
    });

    it('warm idle session delegates to AgentSession.truncateTurns and maps the outcome', async () => {
      await seedTurns();
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockTruncateTurns.mockResolvedValue({ ok: true, keptTurns: 2 });

      const res = await postTruncate(2);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, kept: 2 });
      // 温路径走会话闩锁(读盘→截断→写盘→内存重载),路径与 /messages 同款解析。
      expect(mockTruncateTurns).toHaveBeenCalledTimes(1);
      const [statePath, keepTurns] = mockTruncateTurns.mock.calls[0] as [string, number];
      expect(statePath).toBe(statePathOnDisk());
      expect(keepTurns).toBe(2);

      // 错误映射:温路径 404 → 404。
      mockTruncateTurns.mockResolvedValue({
        ok: false,
        code: 404,
        error: 'Session state not found',
      });
      const res404 = await postTruncate(2);
      expect(res404.status).toBe(404);
      expect((await res404.json()).error).toBe('Session state not found');
    });

    // 闩锁内复检撞上并发轮:out.error 就是 'Session is busy',detail 若原样
    // 透传则与 error 逐字重复——detail 必须是固定解释文案(评审 P3⑧)。
    it('latch-recheck 409 keeps triage shape without duplicating error into detail', async () => {
      await seedTurns();
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockTruncateTurns.mockResolvedValue({ ok: false, code: 409, error: 'Session is busy' });

      const res = await postTruncate(2);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('Session is busy');
      expect(body.reason).toBe('busy');
      expect(typeof body.detail).toBe('string');
      expect(body.detail).not.toBe(body.error);
      expect(body.detail).not.toBe('');
    });

    // 无 body 的 POST 是客户端错误:可选链守卫后走 400 分支,而不是
    // 解引用 undefined 的 TypeError → 500(评审 P3⑦,兄弟路由
    // body.message?.trim() 同款边界)。
    it('bodyless POST is 400 (not a 500 from dereferencing undefined body)', async () => {
      await seedTurns();
      const res = await fetch(`${getUrl()}/api/chat/existing-session/truncate`, {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('keepTurns must be a non-negative integer');
    });

    it('cold session under assembly reservation → 409 with starting triage fields', async () => {
      await seedTurns();
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      // 占位中(另一请求正在装配该冷会话)。
      expect(sm.tryReserveAgentSession('existing-session')).toBe(true);
      try {
        const res = await postTruncate(1);
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('Session is busy');
        expect(body.reason).toBe('starting');
        expect(typeof body.detail).toBe('string');
      } finally {
        sm.cancelAgentSessionReservation('existing-session');
      }
      // 占位释放后同一请求即可截断(槽位不卡死)。
      const resAfter = await postTruncate(1);
      expect(resAfter.status).toBe(200);
      expect(await resAfter.json()).toEqual({ ok: true, kept: 1 });
    });
  });

  // ─── POST /api/chat/:sessionId/respond ───

  describe('POST /api/chat/:sessionId/respond', () => {
    it('returns error when requestId missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'yes' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('requestId is required');
    });

    it('cold session without state → 404 Session state not found', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req-1', response: 'yes' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Session state not found');
    });

    it('cold session with state but no matching interrupt → 404 with activation guidance', async () => {
      // Seed a state WITHOUT pendingInterrupts (a daemon restart mid-wait
      // under the blocking bridge leaves exactly this on disk).
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.saveState('existing-session', {
        id: 'existing-session',
        config: { name: 'test-agent', instructions: '', tools: [] },
        context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req-1', response: 'yes' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('No pending human request matches');
      expect(body.error).toContain('send a message first to activate');
    });

    it('returns error when warm request not found', async () => {
      // Register active session but respondHumanInput returns false and the
      // state tier finds nothing either.
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.respondHumanInput.mockReturnValue(false);
      mockSession.respondViaState.mockResolvedValue({ status: 'not-found' });

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'unknown-req', response: 'yes' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.error).toBe('Request not found or already answered');
    });

    it('tier 1 — warm parked bridge resolve wins memory-first', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.respondHumanInput.mockReturnValue(true);

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'req-1', response: 'my answer' }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(mockSession.respondHumanInput).toHaveBeenCalledWith('req-1', 'my answer');
      // Bridge hit must NOT fall through to the state tier.
      expect(mockSession.respondViaState).not.toHaveBeenCalled();
    });

    it('tier 2 — warm state recovery with remaining interrupts reports the open list', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.respondHumanInput.mockReturnValue(false);
      mockSession.respondViaState.mockResolvedValue({
        status: 'answered',
        remaining: [
          {
            type: 'question',
            questions: [{ id: 'q2', question: 'B?', type: 'text' }],
            toolCallId: 'call-2',
          },
        ],
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'q1', response: { q1: 'A' } }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.waiting).toBe(true);
      // Rust 9995668 shape: remaining interrupts in human-input frame shape.
      expect(body.interrupts).toEqual([
        {
          requestId: 'call-2',
          questions: [{ id: 'q2', question: 'B?', type: 'text' }],
          context: undefined,
        },
      ]);
      expect(mockSession.respondViaState).toHaveBeenCalledWith('q1', { q1: 'A' });
    });

    it('tier 2 — busy session with bridge miss returns not-found and never touches state (返修 P2-1)', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.busy = true;
      mockSession.respondHumanInput.mockReturnValue(false);
      try {
        const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: 'q1',
            response: { q1: { type: 'direct', value: 'A' } },
          }),
        });
        // R2P-163b③（对齐 Rust 409 分诊）：真忙不再误报 200 "not found"
        // ——调用方无从区分「稍后重试」与「请求已答」。
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toBe('Session is busy');
        expect(body.reason).toBe('busy');
        // The state tier must not run: injecting into a busy session's
        // pre-run snapshot would be rolled back by that run's afterRun.
        expect(mockSession.respondViaState).not.toHaveBeenCalled();
      } finally {
        mockSession.busy = false;
      }
    });

    it('tier 2 — garbage question payload → 400 before injection (返修 P3)', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.respondHumanInput.mockReturnValue(false);
      mockSession.respondViaState.mockResolvedValue({
        status: 'invalid',
        error: "Invalid answer for question 'q1': expected {type: 'direct' | 'free-text', value}",
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'q1', response: { q1: 'garbage' } }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("question 'q1'");
    });

    it('tier 2 — warm state emptied → respond returns ack; continuation runs in background (P3 Task 9 全 ack 化)', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockSession.respondHumanInput.mockReturnValue(false);
      mockSession.respondViaState.mockResolvedValue({ status: 'answered', remaining: [] });
      mockSession.continueRunInBackground.mockReturnValue({
        ok: true,
        turnSeq: 2,
        completion: Promise.resolve({ hadError: false }),
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'q1', response: { q1: 'A' } }),
      });
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      await expect(res.json()).resolves.toEqual({
        ok: true,
        sessionId: 'existing-session',
        turnSeq: 2,
      });
      // 续跑是后台驱动（经会话事件通道到达 events 常驻流），leading 帧由此传入。
      expect(mockSession.continueRunInBackground).toHaveBeenCalledWith({ requestId: 'q1' });
    });

    it('tier 3 — cold recovery from persisted pendingInterrupts: one answer of two stays waiting', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.saveState('existing-session', {
        id: 'existing-session',
        config: { name: 'test-agent', instructions: '', tools: [] },
        context: {
          messages: [],
          stepCount: 0,
          createdAt: 0,
          updatedAt: 0,
          pendingInterrupts: [
            {
              request: {
                type: 'question',
                questions: [{ id: 'q1', question: 'A?', type: 'text' }],
                toolCallId: 'call-1',
              },
              createdAt: 1,
            },
            {
              request: {
                type: 'question',
                questions: [{ id: 'q2', question: 'B?', type: 'text' }],
                toolCallId: 'call-2',
              },
              createdAt: 2,
            },
          ],
        },
      });

      // Answer by QUESTION id (frontend convention — dual matching).
      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'q1', response: { q1: { type: 'direct', value: 'A' } } }),
      });
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        waiting: true,
        interrupts: [
          {
            requestId: 'call-2',
            questions: [{ id: 'q2', question: 'B?', type: 'text' }],
            context: undefined,
          },
        ],
      });
      // Injection is on disk (Rust 09b03af write-through): tool result paired
      // to call-1, call-2 still pending.
      const next = await store.loadState('existing-session');
      expect(
        next!.context.messages.some((m: { toolCallId?: string }) => m.toolCallId === 'call-1')
      ).toBe(true);
      expect(next!.context.pendingInterrupts).toHaveLength(1);
      expect(next!.context.pendingInterrupts![0].request.toolCallId).toBe('call-2');
    });

    it('tier 3 — last cold answer rebuilds the session and streams the continuation', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.saveState('existing-session', {
        id: 'existing-session',
        config: { name: 'test-agent', instructions: '', tools: [] },
        context: {
          messages: [],
          stepCount: 0,
          createdAt: 0,
          updatedAt: 0,
          pendingInterrupts: [
            {
              request: {
                type: 'question',
                questions: [{ id: 'q1', question: 'A?', type: 'text' }],
                toolCallId: 'call-1',
              },
              createdAt: 1,
            },
          ],
        },
      });
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockSession.continueRunInBackground.mockReturnValue({
        ok: true,
        turnSeq: 1,
        completion: Promise.resolve({ hadError: false }),
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'call-1',
          response: { q1: { type: 'direct', value: 'A' } },
        }),
      });
      // 全 ack 化（P3 Task 9）：不再劫持为续跑 SSE——ack 同 send 形状，
      // 续跑后台驱动经 events 常驻流。
      await expect(res.json()).resolves.toEqual({
        ok: true,
        sessionId: 'existing-session',
        turnSeq: 1,
      });

      // Rebuild went through AgentSession.resume with the resolved sessionDir
      // and the rebuilt session is registered as the active one.
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);
      expect(sm.getAgentSession('existing-session')).toBe(mockSession);
    });

    it('tier 3 — garbage question payload → 400, disk untouched (返修 P3)', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      const store = sm.getSessionStore(join(tempDir, 'workspace'));
      await store.saveState('existing-session', {
        id: 'existing-session',
        config: { name: 'test-agent', instructions: '', tools: [] },
        context: {
          messages: [],
          stepCount: 0,
          createdAt: 0,
          updatedAt: 0,
          pendingInterrupts: [
            {
              request: {
                type: 'question',
                questions: [{ id: 'q1', question: 'A?', type: 'text' }],
                toolCallId: 'call-1',
              },
              createdAt: 1,
            },
          ],
        },
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'q1', response: 'yes' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid question response');
      // No injection: the interrupt stays pending on disk, no tool message.
      const next = await store.loadState('existing-session');
      expect(next!.context.pendingInterrupts).toHaveLength(1);
      expect(
        next!.context.messages.some((m: { toolCallId?: string }) => m.toolCallId === 'call-1')
      ).toBe(false);
    });
  });

  // ─── POST /api/agents/:name/onetake（一次性调用，原 chat 换名——对齐 Rust 65732f3） ───

  describe('POST /api/agents/:name/onetake', () => {
    it('returns 400 when message missing', async () => {
      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: '/tmp' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('defaults workspacePath to the process cwd (对齐 Rust create_session 兜底)', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });
      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(200);
      const callArg = mockAgentSessionCreate.mock.calls[0][0] as {
        workspacePath: string;
      };
      expect(callArg.workspacePath).toBe(process.cwd());
    });

    it('returns 404 when agent not found', async () => {
      const res = await fetch(`${getUrl()}/api/agents/nonexistent-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });

    // ─── 多模态附件校验（R2P-107，对齐 Rust df699fa）───

    it('rejects invalid attachments with 400 before any session work', async () => {
      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp',
          attachments: [{ kind: 'image', url: 'https://example.com/a.png' }],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('not supported');
    });

    it('empty text + attachments = legal pure-image message (passes the message gate)', async () => {
      // 附件在场即越过 message 必填闸——错误推进到 agent 解析（404 而非
      // 400 'message is required'），证明纯图消息被放行。
      const res = await fetch(`${getUrl()}/api/agents/nonexistent-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: '/tmp',
          attachments: [{ kind: 'image', url: 'file:img-1.png' }],
        }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Agent not found');
    });

    it('empty text + empty attachments still 400 (both-empty rejected)', async () => {
      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '  ', workspacePath: '/tmp', attachments: [] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('streams SSE events for valid new chat', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'hello' } };
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const raw = await res.text();
      const events = parseSSE(raw);
      const eventTypes = events.map((e) => e.event);

      // First event should be session-start with sessionId
      expect(eventTypes).toContain('session-start');
      const startEvent = events.find((e) => e.event === 'session-start');
      expect((startEvent!.data as { sessionId: string }).sessionId).toBe('mock-session-123');

      // Followed by token and done from handleMessage
      expect(eventTypes).toContain('token');
      expect(eventTypes).toContain('done');

      // AgentSession.create should have been called
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);
    });

    it('passes all config fields through to AgentSession.create', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          model: 'gpt-4o',
          thinkingEnabled: true,
          config: {
            skills: { dirs: ['./skills'] },
            tools: {
              mcpConfigPaths: ['./mcp.json'],
              builtinFilter: { shell: false, fileRead: true },
            },
            session: { enabled: false },
            todolist: { enabled: false },
            commands: { enabled: false },
            sandbox: false,
            a2ui: { enabled: true },
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      // Session-init: model comes from agent default, not per-request model
      expect(callArg.skills).toEqual({ dirs: ['./skills', expect.any(String)] });
      expect(callArg.tools).toEqual({
        mcpConfigPaths: ['./mcp.json'],
        builtinFilter: { shell: false, fileRead: true },
        injectFactory: expect.any(Function),
        mcpLoader: expect.any(Function),
      });
      expect(callArg.session).toEqual({ enabled: false });
      expect(callArg.todolist).toEqual({ enabled: false });
      expect(callArg.commands).toEqual({ enabled: false });
      expect(callArg.sandbox).toEqual(expect.objectContaining({ enabled: false }));
      expect(callArg.a2ui).toEqual({ enabled: true });

      // Per-request: model and thinkingEnabled passed to handleMessage
      expect(mockHandleMessage).toHaveBeenCalledTimes(1);
      const msgOpts = mockHandleMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(msgOpts.model).toBe('gpt-4o');
      expect(msgOpts.thinkingEnabled).toBe(true);
    });

    it('normalizes compression for both request shapes (R2P-239 policy object, not collapsed boolean)', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      // 统一对象形状 {enabled: false} → policy 对象 {enabled: false}
      // (AgentSession.create 再译成 runner 的 false;不再在路由层塌缩布尔)
      let res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          config: { compression: { enabled: false } },
        }),
      });
      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);
      let callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.compression).toEqual({ enabled: false });

      mockAgentSessionCreate.mockClear();
      // 旧式裸布尔 true → policy 对象 {enabled: true}
      res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          config: { compression: true },
        }),
      });
      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);
      callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.compression).toEqual({ enabled: true });

      mockAgentSessionCreate.mockClear();
      // 空对象 {} = enabled 未给且无 config.yaml 调优 → 未配置(undefined)
      res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          config: { compression: {} },
        }),
      });
      expect(res.status).toBe(200);
      callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.compression).toBeUndefined();
    });

    it('passes config.yaml compression tuning through to the session (R2P-239, aligned Rust 934d8ce)', async () => {
      // 自带 config.yaml 的独立 app:runner.compression 带 strategy/threshold/
      // keepRecent(请求体只暴露 enabled,调优字段是部署级)。
      const cfgDir = await mkdtemp(join(tmpdir(), 'daemon-chat-cmp-'));
      const configPath = join(cfgDir, 'config.yaml');
      await writeFile(
        configPath,
        `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: test-model\nserver:\n  port: 3100\n  host: localhost\nrunner:\n  compression:\n    enabled: true\n    strategy: truncate\n    threshold: 60\n    keepRecent: 5\n`
      );
      const configManager = new ConfigManager(configPath);
      await configManager.init();
      const agentsDir = join(cfgDir, 'agents');
      const resourceManager = new ResourceManager(
        agentsDir,
        join(cfgDir, 'skills'),
        join(cfgDir, 'crews')
      );
      await resourceManager.init();
      await resourceManager.createAgent({ name: 'test-agent', instructions: 'test instructions' });
      const cfgSessionManager = new SessionManager(join(cfgDir, 'sessions'));
      await cfgSessionManager.init();
      const app = Fastify();
      app.decorate('configManager', configManager);
      app.decorate('resourceManager', resourceManager);
      app.decorate('sessionManager', cfgSessionManager);
      await app.register(chatRoutes);
      await app.listen({ port: 0, host: '127.0.0.1' });
      const appUrl = `http://127.0.0.1:${(app.addresses()[0] as { port: number }).port}`;

      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      try {
        // ① 请求未给 compression → config.yaml 调优字段整体透传。
        let res = await fetch(`${appUrl}/api/agents/test-agent/onetake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
        });
        expect(res.status).toBe(200);
        let callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
        expect(callArg.compression).toEqual({
          enabled: true,
          strategy: 'truncate',
          threshold: 60,
          keepRecent: 5,
        });

        // ② 请求级 enabled 覆盖开关,调优字段仍来自 config.yaml(字段级合并)。
        mockAgentSessionCreate.mockClear();
        res = await fetch(`${appUrl}/api/agents/test-agent/onetake`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'hello',
            workspacePath: '/tmp/test-ws',
            config: { compression: { enabled: false } },
          }),
        });
        expect(res.status).toBe(200);
        callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
        expect(callArg.compression).toEqual({
          enabled: false,
          strategy: 'truncate',
          threshold: 60,
          keepRecent: 5,
        });
      } finally {
        await app.close();
        await rm(cfgDir, { recursive: true, force: true });
      }
    });

    it('inline mcpServers bypass mcpConfigPaths (replacement semantics)', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          config: {
            tools: {
              mcpConfigPaths: ['/legacy/mcp.json'],
              mcpServers: { ctx7: { command: 'npx', args: ['-y', 'x'] } },
            },
          },
        }),
      });
      expect(res.status).toBe(200);
      const callArg = mockAgentSessionCreate.mock.calls[0][0] as {
        tools: { mcpConfigPaths?: string[]; mcpLoader?: (paths: string[]) => Promise<never[]> };
      };
      // 路径轴被旁路;加载器换到内联通道(不接受任何路径)
      expect(callArg.tools.mcpConfigPaths).toEqual([]);
      const inline = await callArg.tools.mcpLoader!(['/should/be/ignored']);
      expect(inline).toEqual([]);
    });

    it('inline agent block replaces the agent file', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      // agent 文件不存在的名字 + 内联块 → 不 404,人设用内联值
      const res = await fetch(`${getUrl()}/api/agents/no-such-agent-file/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          agent: { instructions: '内联人设', name: 'custom-name' },
        }),
      });
      expect(res.status).toBe(200);
      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.agentInstructions).toBe('内联人设');
      expect(callArg.agentName).toBe('custom-name');
    });

    it('inline agent subAgents flow through to delegation (R2P-143, aligned Rust e39477c)', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      // 请求体 `agent.subAgents[]` 直传 delegation：不建 crew 也能 delegate。
      const res = await fetch(`${getUrl()}/api/agents/no-such-agent-file/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          agent: {
            instructions: '主智能体人设',
            subAgents: [
              {
                name: 'researcher',
                instructions: '会做调研',
                description: '调研员',
                maxSteps: 12,
                timeout: 45000,
                inheritParentTools: false,
              },
              // 最小形状：只有必填的 name + instructions，其余缺省。
              { name: 'writer', instructions: '会写文章' },
            ],
          },
        }),
      });
      expect(res.status).toBe(200);
      const callArg = mockAgentSessionCreate.mock.calls[0][0] as {
        subAgents?: Array<Record<string, unknown>>;
      };
      expect(callArg.subAgents).toHaveLength(2);
      expect(callArg.subAgents![0]).toEqual({
        name: 'researcher',
        description: '调研员',
        config: { name: 'researcher', instructions: '会做调研', tools: [] },
        maxSteps: 12,
        timeout: 45000,
        inheritParentTools: false,
        inheritParentSkills: undefined,
      });
      // 缺省形状：description 落空串、开关保持 undefined（delegate 工具侧
      // 按 !== false 取默认继承）。
      expect(callArg.subAgents![1]).toEqual({
        name: 'writer',
        description: '',
        config: { name: 'writer', instructions: '会写文章', tools: [] },
        maxSteps: undefined,
        timeout: undefined,
        inheritParentTools: undefined,
        inheritParentSkills: undefined,
      });
    });

    it('no inline subAgents → delegation stays undefined (unchanged behavior)', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
        }),
      });
      expect(res.status).toBe(200);
      const callArg = mockAgentSessionCreate.mock.calls[0][0] as {
        subAgents?: unknown;
      };
      expect(callArg.subAgents).toBeUndefined();
    });

    it('uses agent defaults when config fields omitted', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          config: {
            sandbox: false,
          },
        }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
      // test agent has no explicit model/skills/mcpPaths, so defaults apply
      expect(callArg.model).toBeUndefined();
      expect(callArg.skills).toEqual({ dirs: [expect.any(String)] });
      expect(callArg.tools).toEqual({
        mcpConfigPaths: [],
        injectFactory: expect.any(Function),
        mcpLoader: expect.any(Function),
      });
      expect(callArg.sandbox).toEqual(expect.objectContaining({ enabled: false }));

      // Per-request params not provided, so handleMessage gets undefined
      const msgOpts = mockHandleMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(msgOpts.model).toBeUndefined();
      expect(msgOpts.thinkingEnabled).toBeUndefined();
    });

    it('calls agentSession.stop() when client disconnects mid-stream', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);

      // handleMessage yields one event then blocks until stop() is called —
      // simulating a long-running agent stream that the client abandons.
      let unblock: () => void = () => {};
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'partial' } };
        await new Promise<void>((resolve) => {
          unblock = resolve;
        });
        yield { event: 'done', data: {} };
      });

      const controller = new AbortController();
      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
        signal: controller.signal,
      });

      // Read the first chunk to ensure the stream has started, then abort —
      // this is the client-disconnect scenario CONC5 addresses.
      const reader = res.body!.getReader();
      await reader.read();
      controller.abort();
      try {
        await reader.read();
      } catch {
        // expected: aborted
      }

      // Allow the 'close' handler on the request to fire.
      await new Promise((r) => setTimeout(r, 100));

      // stop() must have been called exactly once (idempotent disconnect guard)
      // so the agent does not keep running after the client is gone.
      expect(mockSession.stop).toHaveBeenCalledTimes(1);

      // Unblock the mock generator so test teardown doesn't hang.
      unblock();
    });

    it('does not call stop() on normal stream completion', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'hi' } };
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/agents/test-agent/onetake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws' }),
      });
      await res.text();

      // On a clean completion the route must not invoke stop().
      expect(mockSession.stop).not.toHaveBeenCalled();
    });
  });

  // ─── POST /api/chat/:sessionId (RESUME conversation) ───

  describe('POST /api/chat/:sessionId', () => {
    it('returns 400 when message missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('rejects invalid attachments with 400 (resume)', async () => {
      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          attachments: [{ kind: 'image', url: 'file:' }],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('empty path');
    });

    it('empty text + attachments = legal pure-image resume (passes the gate to 410)', async () => {
      // resume 不再静默丢附件：纯图消息越过 message 闸，推进到会话解析
      //（无创建字段 → 410，对齐 Rust send.rs）。
      const res = await fetch(`${getUrl()}/api/chat/no-such-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [{ kind: 'image', url: 'data:image/png;base64,QUJD' }],
        }),
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('Session expired, please start a new conversation');
    });

    it('returns 410 when session not found and no creation fields (R2P-153 首次即建)', async () => {
      const res = await fetch(`${getUrl()}/api/chat/nonexistent-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('Session expired, please start a new conversation');
    });

    it('streams SSE events for valid resume', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'world' } };
        yield { event: 'done', data: {} };
      });

      // R2P-153 双轨迁移：POST 默认 ack 化——旧「send 即流」断言经
      // ?stream=1 过渡轨保持（断言零改动，兼容证明）。
      const res = await fetch(`${getUrl()}/api/chat/existing-session?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'continue' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');

      const raw = await res.text();
      const events = parseSSE(raw);
      const eventTypes = events.map((e) => e.event);

      // No session-start event for resume (only sent on new conversations)
      expect(eventTypes).not.toContain('session-start');

      // Should contain token and done from handleMessage
      expect(eventTypes).toContain('token');
      expect(eventTypes).toContain('done');

      // Token event should carry the expected delta
      const tokenEvent = events.find((e) => e.event === 'token');
      expect((tokenEvent!.data as { delta: string }).delta).toBe('world');
    });

    it('reuses existing AgentSession if already active', async () => {
      // Pre-register an active session
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      sm.setAgentSession('existing-session', mockSession as never);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'continue' }),
      });

      expect(res.status).toBe(200);
      // AgentSession.create should NOT have been called — reused existing
      expect(mockAgentSessionCreate).not.toHaveBeenCalled();
    });

    it('streams error event on handleMessage exception', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'partial' } };
        throw new Error('stream blew up');
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'trigger error' }),
      });

      expect(res.status).toBe(200);
      const raw = await res.text();
      const events = parseSSE(raw);
      const errorEvent = events.find((e) => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.data as { message: string }).message).toBe('Internal server error');
    });

    it('returns 409 when session is busy (with busy triage fields, R2P-154a)', async () => {
      const sm = (fastify as unknown as { sessionManager: SessionManager }).sessionManager;
      mockSession.busy = true;
      sm.setAgentSession('existing-session', mockSession as never);

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      // 向后兼容:error 原文案保留;分诊字段说清在等什么(对齐 32bf25f)。
      expect(body.error).toBe('Session is busy');
      expect(body.reason).toBe('busy');
      expect(typeof body.detail).toBe('string');

      // Reset for other tests
      mockSession.busy = false;
    });

    it('returns 410 when AgentSession.resume throws SessionNotFoundError', async () => {
      mockAgentSessionResume.mockRejectedValue(new SessionNotFoundError('/tmp/missing'));

      const res = await fetch(`${getUrl()}/api/chat/existing-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('Session expired, please start a new conversation');
    });

    it('passes per-request model and thinkingEnabled to handleMessage on resume', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          model: 'gpt-4o',
          thinkingEnabled: true,
        }),
      });

      expect(res.status).toBe(200);

      // Per-request params should be passed to handleMessage
      expect(mockHandleMessage).toHaveBeenCalledTimes(1);
      const msgOpts = mockHandleMessage.mock.calls[0][1] as Record<string, unknown>;
      expect(msgOpts.model).toBe('gpt-4o');
      expect(msgOpts.thinkingEnabled).toBe(true);
    });

    it('uses stored session model for lazy creation on resume', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/existing-session?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);

      // Session resume receives sessionDir as first arg
      const callArg = mockAgentSessionResume.mock.calls[0][0] as string;
      expect(callArg).toContain('existing-session');
    });

    it('resumes from explicit sessionDir even when session is not in the standard tree', async () => {
      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      // Session lives in an explicit "notebook" dir — invisible to the
      // standard {root}/sessions tree; identity comes from its meta.yaml.
      const explicitDir = join(tempDir, 'notebook-sessions', 'my-session');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(explicitDir, { recursive: true });
      await writeMeta(
        explicitDir,
        {
          id: 'my-session',
          workspacePath: join(tempDir, 'workspace'),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          agentName: 'test-agent',
          runnerConfig: { model: 'test-model' },
        },
        defaultNodeHostEnv
      );

      const res = await fetch(`${getUrl()}/api/chat/some-key?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', sessionDir: explicitDir }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);
      expect(mockAgentSessionResume.mock.calls[0][0]).toBe(explicitDir);

      // Identity resolved from the explicit dir's meta.yaml
      const opts = mockAgentSessionResume.mock.calls[0][1] as {
        workspacePath: string;
        agentName: string;
      };
      expect(opts.workspacePath).toBe(join(tempDir, 'workspace'));
      expect(opts.agentName).toBe('test-agent');
    });

    it('returns 410 when explicit sessionDir has no meta.yaml (no creation fields)', async () => {
      const res = await fetch(`${getUrl()}/api/chat/some-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          sessionDir: join(tempDir, 'missing-session-dir'),
        }),
      });

      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('Session expired, please start a new conversation');
    });

    it('reloads crew subAgents on resume when meta.runnerConfig.crewId is set', async () => {
      // Seed a crew on disk so loadCrewConfig + crewToRunnerOptions produce subAgents
      const crewsDir = join(tempDir, 'crews');
      const crewDir = join(crewsDir, 'resume-crew');
      const { mkdir, writeFile: wf } = await import('node:fs/promises');
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await wf(
        join(crewDir, 'CREW.md'),
        '---\nname: resume-crew\nprimary-agent: orchestrator\n---\n\nMemory.\n'
      );
      await wf(
        join(crewDir, 'agents', 'orchestrator.md'),
        '---\nname: orchestrator\n---\n\nLead.\n'
      );
      await wf(
        join(crewDir, 'agents', 'researcher.md'),
        '---\nname: researcher\n---\n\nResearch.\n'
      );

      // Create a session whose meta.yaml carries crewId, so resume detects it
      const store = (
        fastify as unknown as { sessionManager: SessionManager }
      ).sessionManager.getSessionStore(join(tempDir, 'workspace'));
      await store.createWithId('crew-resume-session', 'orchestrator');
      await store.updateMeta('crew-resume-session', {
        runnerConfig: { model: 'test-model', crewId: 'resume-crew' },
      });
      (fastify as unknown as { sessionManager: SessionManager }).sessionManager.registerSession(
        'crew-resume-session',
        join(tempDir, 'workspace')
      );

      mockAgentSessionResume.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/crew-resume-session?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'follow up' }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionResume).toHaveBeenCalledTimes(1);

      // The options passed to AgentSession.resume should contain the
      // subAgents rebuilt from the crew config (researcher is non-primary).
      const resumeOpts = mockAgentSessionResume.mock.calls[0][1] as {
        subAgents?: Array<{ name: string }>;
      };
      expect(resumeOpts.subAgents).toBeDefined();
      expect(resumeOpts.subAgents!.map((s) => s.name)).toEqual(['researcher']);
    });
  });

  // ─── crew 经统一发送端点创建（POST /api/chat/:id 带 crew 字段——
  // 原 /api/crews/:id/chat 已并入，对齐 Rust 65732f3）───

  describe('POST /api/chat/:sessionId {crew} 首次即建', () => {
    beforeEach(async () => {
      // Seed a demo crew with primary (orchestrator) + worker (researcher)
      const crewsDir = join(tempDir, 'crews');
      const crewDir = join(crewsDir, 'demo-crew');
      const { mkdir, writeFile: wf } = await import('node:fs/promises');
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await wf(
        join(crewDir, 'CREW.md'),
        '---\nname: demo-crew\nprimary-agent: orchestrator\n---\n\nShared crew memory.\n'
      );
      await wf(
        join(crewDir, 'agents', 'orchestrator.md'),
        '---\nname: orchestrator\ndescription: primary coordinator\n---\n\nOrchestrate.\n'
      );
      await wf(
        join(crewDir, 'agents', 'researcher.md'),
        '---\nname: researcher\ndescription: research helper\n---\n\nResearch topics.\n'
      );
    });

    it('returns 400 when message missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/crew-new-1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: '/tmp', crew: 'demo-crew' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('message is required');
    });

    it('returns 400 when workspacePath missing', async () => {
      const res = await fetch(`${getUrl()}/api/chat/crew-new-2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', crew: 'demo-crew' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('workspacePath is required to create a session');
    });

    it('returns 410 when the id is unknown and no creation fields are given', async () => {
      const res = await fetch(`${getUrl()}/api/chat/never-existed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toBe('Session expired, please start a new conversation');
    });

    it('returns 404 when crew not found', async () => {
      const res = await fetch(`${getUrl()}/api/chat/crew-new-3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp', crew: 'nonexistent-crew' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Crew not found');
    });

    it('creates via the unified endpoint and acks {sessionId, turnSeq}', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'token', data: { delta: 'crew reply' } };
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/crew-ack-1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          crew: 'demo-crew',
        }),
      });

      expect(res.status).toBe(200);
      // ack 语义（对齐 Rust send.rs）：JSON、{sessionId, turnSeq}——不带流。
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.json();
      expect(body.sessionId).toBe('crew-ack-1');
      expect(typeof body.turnSeq).toBe('number');
      expect('ok' in body).toBe(false);

      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);
    });

    it('passes crewId, subAgents, primary agent name, and crew system prompt to AgentSession.create', async () => {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });

      const res = await fetch(`${getUrl()}/api/chat/crew-ack-2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'hello',
          workspacePath: '/tmp/test-ws',
          crew: 'demo-crew',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);

      const callArg = mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;

      // crewId is persisted to runnerConfig snapshot
      expect(callArg.crewId).toBe('demo-crew');
      // agentName is the primary agent of the crew
      expect(callArg.agentName).toBe('orchestrator');
      // subAgents are non-primary agents (researcher)
      const subAgents = callArg.subAgents as Array<{ name: string }>;
      expect(Array.isArray(subAgents)).toBe(true);
      expect(subAgents.map((s) => s.name)).toEqual(['researcher']);
      // agentInstructions carry the composed crew system prompt (memory + primary instructions + catalog)
      const instructions = callArg.agentInstructions as string;
      expect(instructions).toContain('Shared crew memory');
      expect(instructions).toContain('Orchestrate');
      // BUILTIN_SKILLS_DIR is appended
      expect(callArg.skills).toEqual({ dirs: [expect.any(String)] });
    });

    // CONC5（客户端断连转发 stop）随 crew 创建 ack 化退役——ack 路径没有
    // 请求级流可断；一次性调用的断连语义由 onetake 侧的同款用例覆盖
    //（见 onetake describe 的 'calls agentSession.stop() when client
    // disconnects mid-stream'）。
  });

  // ─── skill/MCP 自包含策略（T7 PORT，对齐 Rust eef05a1）───
  //
  // 装配机制层不再兜底全局 config.yaml（末级 or_else 砍掉），"要不要落
  // 全局"下沉为会话路由策略：
  //   - crew 会话：目录即全世界——私有存在即全部，不存在则为空；
  //   - agent 会话：私有非空用私有，为空落全局。
  // 请求体 body.config 明说的永远最高。
  describe('skill/MCP self-containment policy (aligned Rust eef05a1)', () => {
    let app: FastifyInstance;
    let policyDir: string;
    let agentsDir: string;
    let crewsDir: string;
    const GLOBAL_SKILLS = '/global/skills';
    const GLOBAL_MCP = '/global/mcp.json';

    async function bootApp(): Promise<void> {
      policyDir = await mkdtemp(join(tmpdir(), 'daemon-chat-policy-'));
      const configPath = join(policyDir, 'config.yaml');
      // config.yaml 带全局 skillDirs / mcpConfigPaths 默认值——正是要钉的
      // 那根"全局兜底"轴：crew 不得落它，agent 空私有才落它。
      await writeFile(
        configPath,
        `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: test-model\nserver:\n  port: 3100\n  host: localhost\nrunner:\n  skillDirs:\n    - ${GLOBAL_SKILLS}\n  mcpConfigPaths:\n    - ${GLOBAL_MCP}\n`
      );
      const configManager = new ConfigManager(configPath);
      await configManager.init();

      agentsDir = join(policyDir, 'agents');
      crewsDir = join(policyDir, 'crews');
      const resourceManager = new ResourceManager(agentsDir, join(policyDir, 'skills'), crewsDir);
      await resourceManager.init();

      // 裸 agent：无 skills/、无 mcp.json。
      await resourceManager.createAgent({ name: 'bare-agent', instructions: 'bare' });
      // 富 agent：私有 skills/ 容器 + mcp.json。
      await resourceManager.createAgent({ name: 'rich-agent', instructions: 'rich' });
      await mkdir(join(agentsDir, 'rich-agent', 'skills', 'search'), { recursive: true });
      await writeFile(
        join(agentsDir, 'rich-agent', 'skills', 'search', 'SKILL.md'),
        '---\nname: search\n---\n'
      );
      await writeFile(join(agentsDir, 'rich-agent', 'mcp.json'), '{"mcpServers":{}}');

      const sessionManager = new SessionManager(join(policyDir, 'sessions'));
      await sessionManager.init();

      app = Fastify();
      app.decorate('configManager', configManager);
      app.decorate('resourceManager', resourceManager);
      app.decorate('sessionManager', sessionManager);
      await app.register(chatRoutes);
      await app.listen({ port: 0, host: '127.0.0.1' });
    }

    async function writeCrew(id: string, withPrivate: boolean): Promise<void> {
      const crewDir = join(crewsDir, id);
      await mkdir(join(crewDir, 'agents'), { recursive: true });
      await writeFile(
        join(crewDir, 'CREW.md'),
        `---\nname: ${id}\nprimary-agent: primary\n---\n\nMemory.\n`
      );
      await writeFile(join(crewDir, 'agents', 'primary.md'), '---\nname: primary\n---\n\nLead.\n');
      if (withPrivate) {
        await mkdir(join(crewDir, 'skills', 'marker-skill'), { recursive: true });
        await writeFile(
          join(crewDir, 'skills', 'marker-skill', 'SKILL.md'),
          '---\nname: marker-skill\n---\n'
        );
        await writeFile(join(crewDir, 'mcp.json'), '{"mcpServers":{}}');
      }
    }

    function appUrl(): string {
      const addr = app.addresses()[0];
      return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
    }

    async function postChat(
      path: string,
      extra: Record<string, unknown> = {}
    ): Promise<Record<string, unknown>> {
      mockAgentSessionCreate.mockResolvedValue(mockSession);
      mockHandleMessage.mockImplementation(async function* () {
        yield { event: 'done', data: {} };
      });
      const res = await fetch(`${appUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello', workspacePath: '/tmp/test-ws', ...extra }),
      });
      expect(res.status).toBe(200);
      await res.text();
      expect(mockAgentSessionCreate).toHaveBeenCalledTimes(1);
      return mockAgentSessionCreate.mock.calls[0][0] as Record<string, unknown>;
    }

    beforeEach(async () => {
      await bootApp();
      await writeCrew('bare-crew', false);
      await writeCrew('rich-crew', true);
      // mock 实例跨用例复用——逐用例清理残留调用。
      mockAgentSessionCreate.mockReset();
    });

    afterEach(async () => {
      await Promise.race([app.close(), new Promise((r) => setTimeout(r, 1500))]);
      await rm(policyDir, { recursive: true, force: true });
    });

    it('crew without skills/ or mcp.json inherits nothing (no global fallback)', async () => {
      const callArg = await postChat('/api/chat/policy-crew-bare', { crew: 'bare-crew' });
      // 只剩内置 spec-plan skills（引擎自带，恒在）；全局 config.yaml 轴
      // 不得落进 crew 会话。
      expect(callArg.skills).toEqual({ dirs: [expect.any(String)] });
      expect((callArg.skills as { dirs: string[] }).dirs).not.toContain(GLOBAL_SKILLS);
      // MCP 同理：空私有 → 空路径轴，不落 /global/mcp.json。
      expect(callArg.tools).toEqual(expect.objectContaining({ mcpConfigPaths: [] }));
    });

    it('crew with private skills/ and mcp.json resolves both relative to the crew dir', async () => {
      const callArg = await postChat('/api/chat/policy-crew-rich', { crew: 'rich-crew' });
      const crewDir = join(crewsDir, 'rich-crew');
      expect(callArg.skills).toEqual({
        dirs: [join(crewDir, 'skills'), expect.any(String)],
      });
      expect(callArg.tools).toEqual(
        expect.objectContaining({ mcpConfigPaths: [join(crewDir, 'mcp.json')] })
      );
      // 私有即全部：全局轴不参与。
      expect((callArg.skills as { dirs: string[] }).dirs).not.toContain(GLOBAL_SKILLS);
    });

    it('agent with empty private resources falls back to global config.yaml', async () => {
      const callArg = await postChat('/api/agents/bare-agent/onetake');
      expect(callArg.skills).toEqual({ dirs: [GLOBAL_SKILLS, expect.any(String)] });
      expect(callArg.tools).toEqual(expect.objectContaining({ mcpConfigPaths: [GLOBAL_MCP] }));
    });

    it('agent with private resources replaces (not merges) the global axis', async () => {
      const callArg = await postChat('/api/agents/rich-agent/onetake');
      const agentDir = join(agentsDir, 'rich-agent');
      expect(callArg.skills).toEqual({
        dirs: [join(agentDir, 'skills'), expect.any(String)],
      });
      expect((callArg.skills as { dirs: string[] }).dirs).not.toContain(GLOBAL_SKILLS);
      expect(callArg.tools).toEqual(
        expect.objectContaining({ mcpConfigPaths: [join(agentDir, 'mcp.json')] })
      );
    });
  });
});
