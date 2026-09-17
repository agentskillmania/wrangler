import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';

import { ConfigManager } from '../../../src/core/config-manager.js';
import { ResourceManager } from '../../../src/core/resource-manager.js';
import { SessionManager } from '../../../src/core/session-manager.js';
import { chatRoutes } from '../../../src/routes/chat.js';
import { AgentSession } from '../../../src/core/agent-session.js';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';

// ─── Mock setup ───
// 真路由 + 真 AgentSession + mock EnhancedRunner：常驻 events 流的 e2e
// （R2P-151/R2P-152）——seq/turnSeq 从 pushEvent 一路流到 HTTP wire，
// 重放门控与断线补洞按 data.seq 断言。

const { mockEnhancedRunnerCreate, mockEnhancedRunnerResume } = vi.hoisted(() => ({
  mockEnhancedRunnerCreate: vi.fn(),
  mockEnhancedRunnerResume: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/wrangler')>();
  return {
    ...actual,
    EnhancedRunner: { create: mockEnhancedRunnerCreate, resume: mockEnhancedRunnerResume },
  };
});

vi.mock('@agentskillmania/llm-client', () => ({
  LLMClient: vi.fn().mockReturnValue({
    registerProvider: vi.fn(),
    registerApiKey: vi.fn(),
  }),
}));

/** 注入 factory 使用的 mock LLM 客户端（daemon core 不捆绑内置 LLM）。 */
const mockLLMClient = { call: vi.fn(), stream: vi.fn(), getModelMeta: vi.fn() };

const testConfig = {
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
  server: { port: 3100, host: 'localhost' },
} satisfies import('../../../src/types.js').DaemonConfig;

/** 最小 finalState（runner.run 的返回）。 */
const FINAL_STATE = {
  id: 'test-state',
  config: { name: 'test-agent', instructions: '', tools: [] },
  context: { messages: [], stepCount: 0, createdAt: 0, updatedAt: 0 },
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 脚本化 mock runner：run() 每被调用一次弹出一个「事件脚本」逐帧发射
 * （帧间 sleep，供断流重连测试控制节奏）后返回终态。装好后即接管
 * AgentSession.create 的 EnhancedRunner.create mock。
 */
function scriptedRunner(scripts: Array<Array<[string, unknown?]>>, frameDelayMs = 0) {
  const queue = [...scripts];
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
  const emit = (type: string, ...args: unknown[]) => eventHandlers[type]?.(...args);
  const runner = {
    run: vi.fn().mockImplementation(async () => {
      const script = queue.shift() ?? [['complete']];
      for (const [type, payload] of script) {
        if (payload === undefined) emit(type);
        else emit(type, payload);
        if (frameDelayMs > 0) await sleep(frameDelayMs);
      }
      return {
        state: FINAL_STATE,
        result: { type: 'success', answer: '', totalSteps: 1, tokens: { input: 0, output: 0 } },
      };
    }),
    on: vi.fn((type: string, handler: (...args: unknown[]) => void) => {
      eventHandlers[type] = handler;
    }),
    off: vi.fn(),
    setSessionTitleListener: vi.fn(),
    getToolInfo: vi.fn().mockReturnValue([]),
    getSkillInfo: vi.fn().mockReturnValue([]),
    getConfig: vi.fn().mockReturnValue({ model: 'test-model' }),
  };
  mockEnhancedRunnerCreate.mockResolvedValue(runner);
  return { runner, emit };
}

// ─── SSE 流式读取（fetch ReadableStream → 增量解析帧）──────────────────

interface WireFrame {
  event: string;
  data: Record<string, unknown> & { seq?: number };
}

/** 增量读取 SSE 响应体，逐帧 yield（event 名 + 已解析的 data 对象）。 */
async function* sseFrames(res: Response): AsyncGenerator<WireFrame> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const lines = chunk.split('\n');
        const eventLine = lines.find((l) => l.startsWith('event: '));
        const dataLine = lines.find((l) => l.startsWith('data: '));
        if (eventLine) {
          yield {
            event: eventLine.slice(7),
            data: dataLine ? (JSON.parse(dataLine.slice(6)) as WireFrame['data']) : {},
          };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** 收帧直到谓词命中（带超时兜底），返回全部已读帧。 */
async function collectUntil(
  gen: AsyncGenerator<WireFrame>,
  pred: (f: WireFrame) => boolean,
  timeoutMs = 8000
): Promise<WireFrame[]> {
  const out: WireFrame[] = [];
  const iterator = gen[Symbol.asyncIterator]();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`collectUntil timeout after ${out.length} frames`);
    const next = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`collectUntil timeout after ${out.length} frames`)),
          remaining
        )
      ),
    ]);
    if (next.done) break;
    out.push(next.value);
    if (pred(next.value)) break;
  }
  return out;
}

/**
 * 模拟客户端断开：先关 generator（finally 里 releaseLock 解除 body 的
 * 读取锁），再 cancel 响应体——直接 cancel 会因锁冲突抛错。
 */
async function stopSse(gen: AsyncGenerator<WireFrame>, res: Response): Promise<void> {
  await gen.return(undefined);
  await res.body!.cancel();
}

// ─── App/session 装配 ───

let fastify: FastifyInstance | null = null;
let tempDir: string | null = null;

/** 建 daemon 路由子集（chatRoutes）的真实 fastify 应用。 */
async function buildApp(opts: { idleTtlMs?: number } = {}): Promise<SessionManager> {
  tempDir = await mkdtemp(join(tmpdir(), 'daemon-events-'));

  const configPath = join(tempDir, 'config.yaml');
  await writeFile(
    configPath,
    `llm:\n  providers:\n    - name: openai\n      apiKey: sk-test\n      baseUrl: 'https://api.example.com'\n      models:\n        - modelId: test-model\nserver:\n  port: 3100\n  host: localhost\n`
  );
  const configManager = new ConfigManager(configPath);
  await configManager.init();

  const resourceManager = new ResourceManager(
    join(tempDir, 'agents'),
    join(tempDir, 'skills'),
    join(tempDir, 'crews')
  );
  await resourceManager.init();
  await resourceManager.createAgent({ name: 'test-agent', instructions: 'test instructions' });

  const sessionManager = new SessionManager(
    join(tempDir, 'sessions'),
    defaultNodeHostEnv,
    opts.idleTtlMs !== undefined ? { idleTtlMs: opts.idleTtlMs } : {}
  );
  await sessionManager.init();

  fastify = Fastify();
  fastify.decorate('configManager', configManager);
  fastify.decorate('resourceManager', resourceManager);
  fastify.decorate('sessionManager', sessionManager);
  await fastify.register(chatRoutes);
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  return sessionManager;
}

function getUrl(): string {
  const addr = fastify!.addresses()[0];
  return typeof addr === 'string' ? addr : `http://127.0.0.1:${addr.port}`;
}

/**
 * 建一个温 AgentSession（真 AgentSession + mock runner 已先行装好），
 * 并落盘会话身份（冷路径 resolveSessionContext 的前提）+ 注册进管理器。
 */
async function createWarmSession(
  sessionManager: SessionManager,
  sessionId: string
): Promise<AgentSession> {
  const workspace = join(tempDir!, 'workspace');
  // 盘身份：meta.yaml（agentName/workspacePath/runnerConfig）。
  const store = sessionManager.getSessionStore(workspace);
  await store.createWithId(sessionId, 'test-agent');
  await store.updateMeta(sessionId, { runnerConfig: { model: 'test-model', sandbox: false } });

  const session = await AgentSession.create(
    {
      workspacePath: workspace,
      agentName: 'test-agent',
      sessionId,
      runtime: defaultNodeHostEnv,
      llmClientFactory: vi.fn().mockReturnValue(mockLLMClient),
      sessionManager,
    },
    testConfig
  );
  sessionManager.registerSession(sessionId, workspace);
  sessionManager.setAgentSession(sessionId, session);
  return session;
}

afterEach(async () => {
  if (fastify) {
    await Promise.race([fastify.close(), new Promise((r) => setTimeout(r, 1500))]);
    fastify = null;
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

// ─── Tests ───

describe('GET /api/chat/:sessionId/events (R2P-151 persistent stream)', () => {
  it('live frames carry seq on the wire — first frame seq=1, strictly monotonic, done carries turnSeq', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([[['token', { token: 'a' }], ['token', { token: 'b' }], ['complete']]], 10);
    const session = await createWarmSession(sessionManager, 'live-seq');

    const res = await fetch(`${getUrl()}/api/chat/live-seq/events`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const gen = sseFrames(res);

    // 常驻流先挂上，再驱动轮——流不随轮结束而关闭，读到 done 后手动断开。
    const turn = (async () => {
      for await (const _ of session.handleMessage('hello')) {
        // drain
      }
    })();
    const frames = await collectUntil(gen, (f) => f.event === 'done');
    await turn;
    await stopSse(gen, res);

    // wire 契约：每帧 data.seq（首帧 =1，严格单调）；done 带所属轮 turnSeq。
    expect(frames.map((f) => f.data.seq)).toEqual([1, 2, 3]);
    const done = frames.find((f) => f.event === 'done')!;
    expect(done.data.turnSeq).toBe(1);
    expect((frames[0].data as { delta?: string }).delta).toBe('a');
  });

  it('default (no lastSeq) replays the FULL rolling history before going live', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([
      [['token', { token: 'one' }], ['complete']],
      [['token', { token: 'two' }], ['complete']],
    ]);
    const session = await createWarmSession(sessionManager, 'full-replay');

    // 第一轮先完整跑完——建连时历史里已有 2 帧。
    for await (const _ of session.handleMessage('first')) {
      // drain
    }

    const res = await fetch(`${getUrl()}/api/chat/full-replay/events`);
    // 同一响应体只开一个读取器（ReadableStream 单锁）——重放段与直播段
    // 共用一个 generator。
    const gen = sseFrames(res);
    // 重放段：全量（seq 1..2）。
    const replay = await collectUntil(gen, (f) => f.data.seq === 2);
    expect(replay.map((f) => f.data.seq)).toEqual([1, 2]);

    // 直播段：第二轮的帧续在后面（无缝、无重）。
    const turn = (async () => {
      for await (const _ of session.handleMessage('second')) {
        // drain
      }
    })();
    const live = await collectUntil(gen, (f) => f.event === 'done');
    await turn;
    await stopSse(gen, res);
    expect([...replay, ...live].map((f) => f.data.seq)).toEqual([1, 2, 3, 4]);
  });

  it('?lastSeq=N gating: replay drops seq<=N, replay + live seamless', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([
      [['token', { token: 'one' }], ['complete']],
      [['token', { token: 'two' }], ['complete']],
    ]);
    const session = await createWarmSession(sessionManager, 'gate-replay');

    for await (const _ of session.handleMessage('first')) {
      // drain
    }

    const res = await fetch(`${getUrl()}/api/chat/gate-replay/events?lastSeq=1`);
    // 同一响应体只开一个读取器（ReadableStream 单锁）——重放段与直播段
    // 共用一个 generator。
    const gen = sseFrames(res);
    // 重放门控：seq=1 的 token 帧被丢弃，重放段只余 seq=2 的 done。
    const replay = await collectUntil(gen, (f) => f.data.seq === 2);
    expect(replay.map((f) => f.data.seq)).toEqual([2]);

    const turn = (async () => {
      for await (const _ of session.handleMessage('second')) {
        // drain
      }
    })();
    const live = await collectUntil(gen, (f) => f.event === 'done');
    await turn;
    await stopSse(gen, res);
    // 重放+增量无缝：2（重放）→ 3,4（直播），无重帧无丢帧。
    expect([...replay, ...live].map((f) => f.data.seq)).toEqual([2, 3, 4]);
  });

  it('client disconnect unsubscribes — later turns do not feed the dead connection', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([
      [['token', { token: 'one' }], ['complete']],
      [['token', { token: 'two' }], ['complete']],
    ]);
    const session = await createWarmSession(sessionManager, 'unsub');

    const res = await fetch(`${getUrl()}/api/chat/unsub/events`);
    const gen = sseFrames(res);
    const turn = (async () => {
      for await (const _ of session.handleMessage('first')) {
        // drain
      }
    })();
    await collectUntil(gen, (f) => f.event === 'done');
    await turn;
    await stopSse(gen, res);

    // 断开 → 服务端 close 处理摘除订阅者（轮已结束、无并发写入竞态）。
    await vi.waitFor(() => {
      const subs = (session as unknown as { channelSubscribers: Set<unknown> }).channelSubscribers;
      expect(subs.size).toBe(0);
    });

    // 之后的轮照常落史（退订只摘听者，不影响通道）。
    for await (const _ of session.handleMessage('second')) {
      // drain
    }
    expect(session.historySnapshot().map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('e2e reconnect hole-fill: mid-stream disconnect + lastSeq resume — no dup, no gap (by seq)', async () => {
    const sessionManager = await buildApp();
    // 5 token + done，帧间隔 25ms——第一连接读到第 2 帧后断开，runner 继续。
    const burst: Array<[string, unknown?]> = [];
    for (let i = 0; i < 5; i++) burst.push(['token', { token: `e${i}` }]);
    burst.push(['complete']);
    scriptedRunner([burst], 25);
    const session = await createWarmSession(sessionManager, 'hole-fill');

    // 连接 1：先开轮再收帧，读到 seq=2 后断开（记录 lastSeq）——runner
    // 继续发射，断线期间的帧只落史（本连接已退订）。
    const res1 = await fetch(`${getUrl()}/api/chat/hole-fill/events`);
    const gen1 = sseFrames(res1);
    const turn = (async () => {
      for await (const _ of session.handleMessage('hello')) {
        // drain
      }
    })();
    const conn1 = await collectUntil(gen1, (f) => f.data.seq === 2);
    expect(conn1.map((f) => f.data.seq)).toEqual([1, 2]);
    await stopSse(gen1, res1);

    // 连接 2：带 lastSeq=2 重连——断线期间的帧经重放补上，之后的帧直播。
    const res2 = await fetch(`${getUrl()}/api/chat/hole-fill/events?lastSeq=2`);
    const gen2 = sseFrames(res2);
    const conn2 = await collectUntil(gen2, (f) => f.event === 'done');
    await turn;
    await stopSse(gen2, res2);

    // 无重帧无丢帧：两连接合并恰为 1..6，严格递增（按 seq 断言）。
    const all = [...conn1, ...conn2].map((f) => f.data.seq as number);
    expect(new Set(all).size).toBe(all.length, '无重帧');
    expect(all).toEqual([1, 2, 3, 4, 5, 6], '无丢帧，按 seq 严格续接');
    // 内容与 seq 对齐（e0..e4 + done 各恰一次）。
    const deltas = [...conn1, ...conn2]
      .filter((f) => f.event === 'token')
      .map((f) => (f.data as { delta?: string }).delta);
    expect(deltas).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    expect(all.length).toBe(session.historySnapshot().length);
  });

  it('after idle eviction the cold path rebuilds — replay is EMPTY (history went with the old object)', async () => {
    // 闲置 TTL 5ms：第一轮跑完睡 20ms 后挂流，入口清扫即驱逐温会话。
    const sessionManager = await buildApp({ idleTtlMs: 5 });
    scriptedRunner([[['token', { token: 'stale' }], ['complete']]]);
    const original = await createWarmSession(sessionManager, 'evicted');
    for await (const _ of original.handleMessage('first')) {
      // drain
    }
    expect(original.historySnapshot().length).toBe(2);
    await sleep(20);

    // 冷路径物化（同 resume/respond 装配）：EnhancedRunner.resume 返回带
    // 新脚本的 runner——重建会话的历史/seq/turnSeq 全部从零起。
    const rebuiltRunner = scriptedRunner([[['token', { token: 'fresh' }], ['complete']]]);
    mockEnhancedRunnerResume.mockResolvedValue({
      runner: rebuiltRunner.runner,
      state: FINAL_STATE,
    });

    const res = await fetch(`${getUrl()}/api/chat/evicted/events?lastSeq=0`);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const gen = sseFrames(res);
    const rebuilt = sessionManager.getAgentSession('evicted');
    expect(rebuilt).not.toBe(original, '驱逐后经冷装配重建了新对象');

    // 重放为空（历史随旧对象走）：读到的第一帧就是新对象的直播帧，
    // 新 seq 空间从 1 重新起——客户端需重读磁盘历史对账。
    const turn = (async () => {
      for await (const _ of rebuilt!.handleMessage('second')) {
        // drain
      }
    })();
    const frames = await collectUntil(gen, (f) => f.event === 'done');
    await turn;
    await stopSse(gen, res);
    expect((frames[0].data as { delta?: string }).delta).toBe('fresh');
    expect(frames.map((f) => f.data.seq)).toEqual([1, 2]);
    expect(frames.find((f) => f.event === 'done')!.data.turnSeq).toBe(1);
    expect(
      frames.some((f) => (f.data as { delta?: string }).delta === 'stale'),
      '旧对象的历史未被重放'
    ).toBe(false);
  });

  it('bad lastSeq → 400; unknown session → 404', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([[['complete']]]);
    await createWarmSession(sessionManager, 'validation');

    const bad = await fetch(`${getUrl()}/api/chat/validation/events?lastSeq=abc`);
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error).toContain('lastSeq');

    const notFound = await fetch(`${getUrl()}/api/chat/no-such-session/events`);
    expect(notFound.status).toBe(404);
  });
});
