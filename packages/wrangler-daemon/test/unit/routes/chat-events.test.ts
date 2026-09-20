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
// 真路由 + 真 AgentSession + mock AgentHarness：常驻 events 流的 e2e
// （R2P-151/R2P-152）——seq/turnSeq 从 pushEvent 一路流到 HTTP wire，
// 重放门控与断线补洞按 data.seq 断言。

const { mockAgentHarnessCreate, mockAgentHarnessResume } = vi.hoisted(() => ({
  mockAgentHarnessCreate: vi.fn(),
  mockAgentHarnessResume: vi.fn(),
}));

vi.mock('@agentskillmania/wrangler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskillmania/wrangler')>();
  return {
    ...actual,
    AgentHarness: { create: mockAgentHarnessCreate, resume: mockAgentHarnessResume },
  };
});

vi.mock('@agentskillmania/llm-client', () => {
  // 保留隔离但补全静态面：宿主工厂（wrangler 的 createLLMClient）调
  // `LLMClient.quickInit(...)`，裸 vi.fn() 会让冷装配路径 500
  // （alpha.2 依赖解析变化后本 mock 开始生效，暴露了这个缺口）。
  const client = {
    registerProvider: vi.fn(),
    registerApiKey: vi.fn(),
    call: vi.fn(),
    stream: vi.fn(),
    getModelMeta: vi.fn(),
  };
  return {
    LLMClient: Object.assign(vi.fn().mockReturnValue(client), {
      quickInit: vi.fn().mockReturnValue(client),
    }),
  };
});

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
 * AgentSession.create 的 AgentHarness.create mock。
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
  mockAgentHarnessCreate.mockResolvedValue(runner);
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

/**
 * 通道帧的 seq 序列——剥掉 history-end/session-evicted 等合成分界帧
 * （它们无自身 seq，载荷描述的是 seq 空间本身）。
 */
function channelSeqs(frames: WireFrame[]): number[] {
  return frames
    .filter((f) => f.event !== 'history-end' && f.event !== 'session-evicted')
    .map((f) => f.data.seq as number);
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
  sessionId: string,
  limits?: { maxInputLength?: number }
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
      limits,
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
    expect(channelSeqs(frames)).toEqual([1, 2, 3]);
    const done = frames.find((f) => f.event === 'done')!;
    expect(done.data.turnSeq).toBe(1);
    expect((frames.find((f) => f.event === 'token')!.data as { delta?: string }).delta).toBe('a');
    // 空历史建连：首帧是 history-end 分界（firstSeq=下一帧将取的 seq=1，
    // lastSeq=0——空窗），先于任何直播帧。
    expect(frames[0].event).toBe('history-end');
    expect(frames[0].data).toEqual({ firstSeq: 1, lastSeq: 0 });
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
    // 重放段：全量（seq 1..2）+ history-end 分界帧收尾（重放段的终结符）。
    const replay = await collectUntil(gen, (f) => f.event === 'history-end');
    expect(channelSeqs(replay)).toEqual([1, 2]);
    expect(replay.at(-1)!.data).toEqual({ firstSeq: 1, lastSeq: 2 });

    // 直播段：第二轮的帧续在后面（无缝、无重）。
    const turn = (async () => {
      for await (const _ of session.handleMessage('second')) {
        // drain
      }
    })();
    const live = await collectUntil(gen, (f) => f.event === 'done');
    await turn;
    await stopSse(gen, res);
    expect(channelSeqs([...replay, ...live])).toEqual([1, 2, 3, 4]);
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
    // 重放门控：seq=1 的 token 帧被丢弃，重放段只余 seq=2 的 done +
    // history-end 分界。分界帧描述保留窗（firstSeq=1），不受门控影响。
    const replay = await collectUntil(gen, (f) => f.event === 'history-end');
    expect(channelSeqs(replay)).toEqual([2]);
    expect(replay.at(-1)!.data).toEqual({ firstSeq: 1, lastSeq: 2 });

    const turn = (async () => {
      for await (const _ of session.handleMessage('second')) {
        // drain
      }
    })();
    const live = await collectUntil(gen, (f) => f.event === 'done');
    await turn;
    await stopSse(gen, res);
    // 重放+增量无缝：2（重放）→ 3,4（直播），无重帧无丢帧。
    expect(channelSeqs([...replay, ...live])).toEqual([2, 3, 4]);
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
    expect(channelSeqs(conn1)).toEqual([1, 2]);
    await stopSse(gen1, res1);

    // 连接 2：带 lastSeq=2 重连——断线期间的帧经重放补上，之后的帧直播。
    const res2 = await fetch(`${getUrl()}/api/chat/hole-fill/events?lastSeq=2`);
    const gen2 = sseFrames(res2);
    const conn2 = await collectUntil(gen2, (f) => f.event === 'done');
    await turn;
    await stopSse(gen2, res2);

    // 无重帧无丢帧：两连接合并恰为 1..6，严格递增（按 seq 断言，剥掉
    // 合成分界帧）。
    const all = [...conn1, ...conn2];
    const seqs = channelSeqs(all);
    expect(new Set(seqs).size).toBe(seqs.length, '无重帧');
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6], '无丢帧，按 seq 严格续接');
    // 内容与 seq 对齐（e0..e4 + done 各恰一次）。
    const deltas = all
      .filter((f) => f.event === 'token')
      .map((f) => (f.data as { delta?: string }).delta);
    expect(deltas).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
    expect(seqs.length).toBe(session.historySnapshot().length);
  });

  it('history-end divider: normal reconnect aligned; head-trim flags the gap (firstSeq jumps)', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([[['token', { token: 'a' }], ['token', { token: 'b' }], ['complete']]]);
    const session = await createWarmSession(sessionManager, 'divider');
    for await (const _ of session.handleMessage('first')) {
      // drain —— 历史落 3 帧（seq 1..3）
    }

    // 场景一（正常重连，无 gap 信号）：客户端已见 seq=2，窗口完整
    // [1..3]——分界帧 firstSeq=1 ≤ 2+1、lastSeq=3 ≥ 2，语义自洽。
    const res1 = await fetch(`${getUrl()}/api/chat/divider/events?lastSeq=2`);
    const gen1 = sseFrames(res1);
    const phase1 = await collectUntil(gen1, (f) => f.event === 'history-end');
    await stopSse(gen1, res1);
    expect(channelSeqs(phase1)).toEqual([3], '只补 seq=3');
    const d1 = phase1.at(-1)!.data as { firstSeq: number; lastSeq: number };
    expect(d1).toEqual({ firstSeq: 1, lastSeq: 3 });
    expect(d1.firstSeq <= 2 + 1, '无 gap 信号').toBe(true);
    expect(d1.lastSeq >= 2, '无复位信号').toBe(true);

    // 场景二（裁头 gap）：模拟安全阀裁掉窗口最旧 2 帧（seq 1/2 没了，
    // 窗口只剩 [3]），客户端 lastSeq=1——firstSeq(3) > 1+1 即 gap 信号。
    const window = (session as unknown as { history: unknown[] }).history;
    window.shift();
    window.shift();
    const res2 = await fetch(`${getUrl()}/api/chat/divider/events?lastSeq=1`);
    const gen2 = sseFrames(res2);
    const phase2 = await collectUntil(gen2, (f) => f.event === 'history-end');
    await stopSse(gen2, res2);
    expect(channelSeqs(phase2)).toEqual([3], 'seq=1 已被裁，seq=3 重放');
    const d2 = phase2.at(-1)!.data as { firstSeq: number; lastSeq: number };
    expect(d2).toEqual({ firstSeq: 3, lastSeq: 3 });
    expect(d2.firstSeq > 1 + 1, 'firstSeq 跳变 = 裁头 gap 信号').toBe(true);
  });

  it('zombie stream watchdog: eviction under an open stream → session-evicted frame + stream ends', async () => {
    // 闲置 TTL 5ms：连接期间会话被惰性驱逐（模拟另一入口的清扫）——
    // 看门狗在 ≤5s 内检测到注册表对象失配，发合成分界帧并终结流。
    const sessionManager = await buildApp({ idleTtlMs: 5 });
    scriptedRunner([[['token', { token: 'a' }], ['complete']]]);
    const session = await createWarmSession(sessionManager, 'zombie');

    const res = await fetch(`${getUrl()}/api/chat/zombie/events`);
    const gen = sseFrames(res);
    const turn = (async () => {
      for await (const _ of session.handleMessage('first')) {
        // drain
      }
    })();
    await collectUntil(gen, (f) => f.event === 'history-end');
    await turn;
    await sleep(20); // 轮已结束、闲置超龄
    // TTL 5ms 下会话可能已被任一惰性触发点先行清扫（events 入口自身的
    // evictIdleSessions、或本显式调用）——断言的实质是「已下线」而非
    // 「恰由本次调用下线」。
    sessionManager.evictIdleSessions();
    expect(sessionManager.getAgentSession('zombie')).not.toBe(session, '会话已被清扫下线');

    // 看门狗兜底（周期 5s）：拿到明确的 session-evicted 而非裸 EOF 挂死。
    const tail = await collectUntil(gen, (f) => f.event === 'session-evicted', 9000);
    expect(tail.at(-1)!.data).toEqual({ sessionId: 'zombie' });
    // 流真正终结（不是只发了帧还挂着连接）。
    const after = await gen.next();
    expect(after.done).toBe(true, '流已被 end() 终结');
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

    // 冷路径物化（同 resume/respond 装配）：AgentHarness.resume 返回带
    // 新脚本的 runner——重建会话的历史/seq/turnSeq 全部从零起。
    const rebuiltRunner = scriptedRunner([[['token', { token: 'fresh' }], ['complete']]]);
    mockAgentHarnessResume.mockResolvedValue({
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
    // 分界帧场景三（驱逐重建复位）：客户端上一 seq 空间已见 seq=2，
    // 重建对象的空窗分界 lastSeq=0 < 2——seq 空间重启的明确信号。
    expect(frames[0].event).toBe('history-end');
    expect(frames[0].data).toEqual({ firstSeq: 1, lastSeq: 0 });
    expect((frames[0].data.lastSeq as number) < 2, 'lastSeq 倒退 = 复位信号').toBe(true);
    expect((frames.find((f) => f.event === 'token')!.data as { delta?: string }).delta).toBe(
      'fresh'
    );
    expect(channelSeqs(frames)).toEqual([1, 2]);
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

// ─── POST /api/chat/:id ack 化（R2P-153，对齐 Rust 65732f3 的 send ack）───
//
// 主接口语义：默认 POST 返回 JSON ack（含本轮轮号），轮帧全部走常驻
// events 流——「先挂流再发送」（对齐 Rust e2e drive_turn 助手：订阅早于
// POST，本轮帧全走直播，消灭快轮竞态）；冷会话（挂流 404）退「先 POST
// 再挂流」，早帧由建连重放补齐。

describe('POST /api/chat/:sessionId ack + persistent events (R2P-153 dual-track)', () => {
  it('ack→events full chain: POST returns {ok,sessionId,turnSeq} JSON; token+done arrive on the events stream with matching turnSeq', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([[['token', { token: 'hello' }], ['complete']]]);
    await createWarmSession(sessionManager, 'ack-chain');

    // 先挂流再发送——本轮帧全走直播段。
    const res = await fetch(`${getUrl()}/api/chat/ack-chain/events`);
    const gen = sseFrames(res);

    const post = await fetch(`${getUrl()}/api/chat/ack-chain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    // ack 契约：JSON（不再是 SSE），带 ok/sessionId/turnSeq。
    expect(post.status).toBe(200);
    expect(post.headers.get('content-type')).toContain('application/json');
    const ack = (await post.json()) as { ok: boolean; sessionId: string; turnSeq: number };
    expect(ack).toEqual({ ok: true, sessionId: 'ack-chain', turnSeq: 1 });

    // 全链路：token → done 都在 events 流上到达，done 的 turnSeq 与 ack 匹配。
    const frames = await collectUntil(gen, (f) => f.event === 'done');
    await stopSse(gen, res);
    expect((frames.find((f) => f.event === 'token')!.data as { delta?: string }).delta).toBe(
      'hello'
    );
    const done = frames.find((f) => f.event === 'done')!;
    expect(done.data.turnSeq).toBe(ack.turnSeq);
  });

  it('one persistent connection spans turns: second ack on the SAME stream, done turnSeq increments', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([
      [['token', { token: 'one' }], ['complete']],
      [['token', { token: 'two' }], ['complete']],
    ]);
    await createWarmSession(sessionManager, 'multi-turn');

    const res = await fetch(`${getUrl()}/api/chat/multi-turn/events`);
    const gen = sseFrames(res);

    const post1 = await fetch(`${getUrl()}/api/chat/multi-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'first' }),
    });
    const ack1 = (await post1.json()) as { turnSeq: number };
    const t1 = await collectUntil(gen, (f) => f.event === 'done');
    expect(t1.at(-1)!.data.turnSeq).toBe(ack1.turnSeq);

    // 第二轮：同一连接（不重连），done 归属第二轮号。fast resend 的清障
    // 窗 = done 帧到闩锁释放之间的落盘时长（stream-first-then-persist）；
    // 慢机上可能超过 busyCleared 的 100ms 宽限 → 409（R2P-163b④）：有界
    // 重试保留快发语义（每次重试仍走清障路径），不再对计时敏感。
    let post2 = await fetch(`${getUrl()}/api/chat/multi-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'second' }),
    });
    for (let i = 0; i < 50 && post2.status === 409; i++) {
      await new Promise((r) => setTimeout(r, 20));
      post2 = await fetch(`${getUrl()}/api/chat/multi-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'second' }),
      });
    }
    const ack2 = (await post2.json()) as { turnSeq: number };
    expect(ack2.turnSeq).toBe(ack1.turnSeq + 1);
    const t2 = await collectUntil(
      gen,
      (f) => f.event === 'done' && f.data.turnSeq === ack2.turnSeq
    );
    await stopSse(gen, res);
    expect((t2.find((f) => f.event === 'token')!.data as { delta?: string }).delta).toBe('two');
    // 全程一条流：两个 done 之间无分界帧以外的重连痕迹（history-end 只在
    // 建连时发过一次，位于第一帧）。
    expect(t1[0].event).toBe('history-end');
    expect(t2.filter((f) => f.event === 'history-end')).toEqual([]);
  });

  it('cold session: POST ack first (lazy materialization), then attach — replay covers the whole turn', async () => {
    const sessionManager = await buildApp();
    // 冷会话：盘上有身份（daemon 重启后的状态），注册表无温对象。
    const workspace = join(tempDir!, 'workspace');
    const store = sessionManager.getSessionStore(workspace);
    await store.createWithId('cold-ack', 'test-agent');
    await store.updateMeta('cold-ack', { runnerConfig: { model: 'test-model', sandbox: false } });
    sessionManager.registerSession('cold-ack', workspace);

    const rebuiltRunner = scriptedRunner([[['token', { token: 'cold' }], ['complete']]]);
    mockAgentHarnessResume.mockResolvedValue({
      runner: rebuiltRunner.runner,
      state: FINAL_STATE,
    });

    const post = await fetch(`${getUrl()}/api/chat/cold-ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    const ack = (await post.json()) as { ok: boolean; turnSeq: number };
    expect(ack.ok).toBe(true);

    // 建连重放（无 lastSeq）补齐 ack 与挂流之间已发生的帧。
    const res = await fetch(`${getUrl()}/api/chat/cold-ack/events`);
    const gen = sseFrames(res);
    const frames = await collectUntil(gen, (f) => f.event === 'done');
    await stopSse(gen, res);
    expect((frames.find((f) => f.event === 'token')!.data as { delta?: string }).delta).toBe(
      'cold'
    );
    expect(frames.find((f) => f.event === 'done')!.data.turnSeq).toBe(ack.turnSeq);
  });

  it('busy → 409 with triage fields (ack path keeps the R2P-154a shape)', async () => {
    const sessionManager = await buildApp();
    // 慢轮（帧间隔 300ms > busy 宽限 100ms）：第一轮 ack 后紧接的第二发
    // 确定性撞 busy。
    scriptedRunner([[['token', { token: 'slow' }], ['complete']]], 300);
    await createWarmSession(sessionManager, 'ack-busy');

    const res = await fetch(`${getUrl()}/api/chat/ack-busy/events`);
    const gen = sseFrames(res);
    const post1 = await fetch(`${getUrl()}/api/chat/ack-busy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'first' }),
    });
    expect(post1.status).toBe(200);

    const post2 = await fetch(`${getUrl()}/api/chat/ack-busy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'second' }),
    });
    expect(post2.status).toBe(409);
    const body = (await post2.json()) as { error: string; reason: string; detail: string };
    expect(body.error).toBe('Session is busy');
    expect(body.reason).toBe('busy');
    expect(typeof body.detail).toBe('string');

    // 收尾：第一轮照常完成（第二发的 409 不影响在飞轮）。
    await collectUntil(gen, (f) => f.event === 'done', 15000);
    await stopSse(gen, res);
  });

  it('drive errors surface as error frames on the events stream (ack already returned)', async () => {
    const sessionManager = await buildApp();
    const handle = scriptedRunner([[['complete']]]);
    // 内核 run() 抛错 → driveTurn 的 catch 把 error 帧经 pushEvent 进通道。
    handle.runner.run.mockImplementationOnce(async () => {
      throw new Error('kernel exploded');
    });
    await createWarmSession(sessionManager, 'ack-error');

    const res = await fetch(`${getUrl()}/api/chat/ack-error/events`);
    const gen = sseFrames(res);
    const post = await fetch(`${getUrl()}/api/chat/ack-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'go' }),
    });
    expect(post.status).toBe(200);

    const frames = await collectUntil(gen, (f) => f.event === 'error');
    await stopSse(gen, res);
    // 与旧轨同源（driveTurn 的 catch 走 String(err)）：错误经会话流 error 帧
    // 上报，HTTP ack 层无第二次机会。
    expect((frames.find((f) => f.event === 'error')!.data as { message?: string }).message).toBe(
      'Error: kernel exploded'
    );
  });

  it('oversized message → 400 on the ack track (limit rejected before the turn starts, status not polluted)', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([[['complete']]]);
    // maxInputLength=5 的温会话：超限消息在开轮前拒（对齐 Rust append
    // 失败 400——ack 响应尚未定形，HTTP 层还能报错）。
    await createWarmSession(sessionManager, 'ack-limit', { maxInputLength: 5 });

    const post = await fetch(`${getUrl()}/api/chat/ack-limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'way too long for the limit' }),
    });
    expect(post.status).toBe(400);
    const body = (await post.json()) as { error: string };
    expect(body.error).toContain('Input exceeds maximum length');

    // 拒绝不得污染会话状态（返修 P3-1：running 只在确定开轮后置位）。
    expect(
      (sessionManager as unknown as { getStatus(id: string): string }).getStatus('ack-limit')
    ).not.toBe('running');
    // 未开轮：通道无帧（挂流只见 history-end 分界，重放为空）。
    const res = await fetch(`${getUrl()}/api/chat/ack-limit/events`);
    const gen = sseFrames(res);
    const seen = await collectUntil(gen, (fr) => fr.event === 'history-end');
    await stopSse(gen, res);
    expect(seen.filter((fr) => fr.event !== 'history-end')).toEqual([]);
  });

  it('?stream=1 legacy track: full-shape SSE with Deprecation header, unchanged wire', async () => {
    const sessionManager = await buildApp();
    scriptedRunner([[['token', { token: 'legacy' }], ['complete']]]);
    await createWarmSession(sessionManager, 'legacy-track');

    const res = await fetch(`${getUrl()}/api/chat/legacy-track?stream=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    // 旧轨全形状：SSE 响应 + Deprecation 提示头 + Sunset 移除时间表（RFC 8594）。
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('deprecation')).toBe('true');
    expect(res.headers.get('sunset')).toBe('Sun, 01 Mar 2026 00:00:00 GMT');

    const gen = sseFrames(res);
    const frames = await collectUntil(gen, (f) => f.event === 'done');
    expect((frames.find((f) => f.event === 'token')!.data as { delta?: string }).delta).toBe(
      'legacy'
    );
    expect(frames.find((f) => f.event === 'done')!.data.turnSeq).toBe(1);
    // 旧轨语义不变：请求级流——done 后服务器关流（读到 EOF，非挂起）。
    const eof = await Promise.race([
      gen.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('legacy stream hung')), 3000)
      ),
    ]);
    expect(eof.done).toBe(true);
  });
});
