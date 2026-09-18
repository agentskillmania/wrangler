import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// chatEventsStream.js 在模块顶层读 location.origin——先桩后动态导入
// （静态 import 会被提升到桩之前，模块求值即 ReferenceError）。
vi.stubGlobal('location', { origin: 'http://mock.local' });
const { openEventsStream } = await import('../../../src/static/js/helpers/chatEventsStream.js');

// ─── 测试脚手架：mock fetch + 可控 SSE body ───────────────────────────────

type WireFrame = { event: string; data: unknown };

/** 一帧 SSE 文本。 */
function f(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * 可控直播流：push/end 驱动 reader.read() 的决议（同构 fetch body 的
 * ReadableStream——helper 只依赖 getReader().read() 协议）。
 */
function liveStream() {
  const chunks: Uint8Array[] = [];
  const waiters: Array<(r: { done: boolean; value?: Uint8Array }) => void> = [];
  let ended = false;
  const settle = () => {
    while (waiters.length > 0 && (chunks.length > 0 || ended)) {
      const resolve = waiters.shift()!;
      if (chunks.length > 0) resolve({ done: false, value: chunks.shift()! });
      else resolve({ done: true, value: undefined });
    }
  };
  return {
    okResponse: {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: (): Promise<{ done: boolean; value?: Uint8Array }> =>
            new Promise((resolve) => {
              if (chunks.length > 0) resolve({ done: false, value: chunks.shift()! });
              else if (ended) resolve({ done: true, value: undefined });
              else waiters.push(resolve);
            }),
        }),
      },
    },
    push(text: string): void {
      chunks.push(enc(text));
      settle();
    },
    end(): void {
      ended = true;
      settle();
    },
  };
}

let mockFetch: ReturnType<typeof vi.fn>;
let frames: WireFrame[];
let opened: number;
let errors: unknown[];
let terminals: WireFrame[];

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  frames = [];
  opened = 0;
  errors = [];
  terminals = [];
});

afterEach(() => {
  vi.unstubAllGlobals(); // 只影响 fetch——location 已在模块求值时被消费
  vi.useRealTimers();
});

/** 以给定 opts 开流并注册收集器。 */
function open(opts: Record<string, unknown> = {}) {
  return openEventsStream(
    's1',
    {
      onOpen: () => {
        opened += 1;
      },
      onFrame: (fr: WireFrame) => {
        frames.push(fr);
      },
      onError: (e: unknown) => {
        errors.push(e);
      },
      onTerminal: (fr: WireFrame) => {
        terminals.push(fr);
      },
    },
    opts
  );
}

/** 捕获第 n 次（0 起）fetch 的 URL。 */
function url(n: number): string {
  return mockFetch.mock.calls[n][0] as string;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('chatEventsStream client (R2P-153 返修 P2-2)', () => {
  it('parses SSE blocks: keep-alive comments skipped, JSON parsed, non-JSON data kept as text', async () => {
    const s = liveStream();
    mockFetch.mockResolvedValueOnce(s.okResponse);
    open();
    s.push(': keep-alive\n\n');
    s.push(f('token', { delta: 'hi', seq: 1 }));
    s.push('event: raw\ndata: not-json\n\n');
    s.end();
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(frames[0]).toEqual({ event: 'token', data: { delta: 'hi', seq: 1 } });
    expect(frames[1]).toEqual({ event: 'raw', data: 'not-json' });
  });

  it('seq dedup: frames at or below the seen watermark are dropped; watermark advances', async () => {
    const s = liveStream();
    mockFetch.mockResolvedValueOnce(s.okResponse);
    open();
    s.push(f('token', { delta: 'a', seq: 1 }));
    s.push(f('token', { delta: 'a', seq: 1 })); // 重放/直播交界重复
    s.push(f('token', { delta: 'b', seq: 2 }));
    s.end();
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(frames.map((x) => (x.data as { seq: number }).seq)).toEqual([1, 2]);
  });

  it('suppressReplay: pre-divider frames suppressed but still advance lastSeq; divider itself delivered', async () => {
    vi.useFakeTimers();
    const s = liveStream();
    // 第二连接（流结束后重连）保持挂起即可——本例只断言重连 URL 的 lastSeq。
    const s2 = liveStream();
    mockFetch.mockResolvedValueOnce(s.okResponse);
    mockFetch.mockResolvedValueOnce(s2.okResponse);
    open({ lastSeq: 0, suppressReplay: true });
    s.push(f('token', { delta: 'old1', seq: 1 }));
    s.push(f('token', { delta: 'old2', seq: 2 }));
    s.push(f('history-end', { firstSeq: 1, lastSeq: 2 }));
    s.push(f('token', { delta: 'live', seq: 3 }));
    s.end();
    await vi.waitFor(() => expect(frames.length).toBe(2));
    // 分界帧照常投递 + 之后的直播帧投递；分界前的重放段被抑制。
    expect(frames[0].event).toBe('history-end');
    expect((frames[1].data as { delta: string }).delta).toBe('live');
    // 抑制不豁免记账：重连 URL 携带被抑制帧推进后的 lastSeq=3。
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(url(1)).toContain('lastSeq=3');
  });

  it('stream end → backoff reconnect carrying lastSeq; continuation frames flow on the new connection', async () => {
    vi.useFakeTimers();
    const s1 = liveStream();
    const s2 = liveStream();
    mockFetch.mockResolvedValueOnce(s1.okResponse);
    mockFetch.mockResolvedValueOnce(s2.okResponse);
    open();
    s1.push(f('token', { delta: 'a', seq: 1 }));
    s1.end();
    await vi.advanceTimersByTimeAsync(1100);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(url(1)).toContain('lastSeq=1');
    // 新连接续流（seq 空间无缝）。
    s2.push(f('token', { delta: 'b', seq: 2 }));
    await vi.waitFor(() =>
      expect(frames.map((x) => (x.data as { delta: string }).delta)).toEqual(['a', 'b'])
    );
  });

  it('onOpen fires once per successful attach', async () => {
    const s = liveStream();
    mockFetch.mockResolvedValueOnce(s.okResponse);
    open();
    s.push(f('token', { delta: 'a', seq: 1 }));
    await vi.waitFor(() => expect(opened).toBe(1));
    s.push(f('token', { delta: 'b', seq: 2 }));
    await vi.waitFor(() => expect(frames.length).toBe(2));
    expect(opened).toBe(1);
  });

  it('HTTP error (404) → onError once, no auto-reconnect', async () => {
    vi.useFakeTimers();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    open();
    await vi.waitFor(() => expect(errors.length).toBe(1));
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((errors[0] as Error).message).toContain('404');
  });

  it('session-evicted frame → onTerminal, no reconnect', async () => {
    vi.useFakeTimers();
    const s = liveStream();
    mockFetch.mockResolvedValueOnce(s.okResponse);
    open();
    s.push(f('token', { delta: 'a', seq: 1 }));
    s.push(f('session-evicted', { sessionId: 's1' }));
    await vi.waitFor(() => expect(terminals.length).toBe(1));
    expect(terminals[0].data).toEqual({ sessionId: 's1' });
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('close() aborts the in-flight fetch and never reconnects (no onError for the abort)', async () => {
    vi.useFakeTimers();
    const s = liveStream();
    mockFetch.mockResolvedValueOnce(s.okResponse);
    const handle = open();
    const signal = mockFetch.mock.calls[0][1].signal as AbortSignal;
    handle.close();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });
});
