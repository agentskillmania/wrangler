/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TimelineEntry } from '../../src/types.js';

// ---------------------------------------------------------------------------​
// Mocks
// ---------------------------------------------------------------------------​​

const mockAddUserMessage = vi.fn();

vi.mock('@agentskillmania/colts', () => ({
  addUserMessage: (...args: unknown[]) => mockAddUserMessage(...args),
}));

let mockConsumeResult: TimelineEntry[] = [];
let mockFlushResult: TimelineEntry[] = [];

vi.mock('../../src/hooks/use-stream-consumer.js', () => ({
  StreamConsumer: class {
    consume = vi.fn(() => mockConsumeResult);
    flush = vi.fn(() => mockFlushResult);
  },
}));

// Import the hook AFTER mocks are registered
import { useAgent } from '../../src/hooks/use-agent.js';

// ---------------------------------------------------------------------------​
// Mock runner factory
// ---------------------------------------------------------------------------​​

let mockStreamEvents: Record<string, unknown>[] = [];
let mockRunStreamError: Error | null = null;

function createMockRunner() {
  return {
    runStream: vi.fn().mockImplementation(() => {
      if (mockRunStreamError) {
        return (async function* () {
          throw mockRunStreamError;
        })();
      }
      return (async function* () {
        for (const event of mockStreamEvents) {
          yield event;
        }
      })();
    }),
    run: vi.fn(),
    on: vi.fn(),
  };
}

function createMockState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    context: { messages: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------​
// Tests
// ---------------------------------------------------------------------------​​

describe('useAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamEvents = [];
    mockRunStreamError = null;
    mockConsumeResult = [];
    mockFlushResult = [];

    mockAddUserMessage.mockImplementation((state: Record<string, unknown>, _msg: string) => {
      return {
        ...state,
        context: {
          ...state.context,
          messages: [...(state.context?.messages ?? []), { role: 'user', content: _msg }],
        },
      };
    });
  });

  // -------------------------------------------------------------------------​
  // Initialization
  // -------------------------------------------------------------------------​

  it('returns empty entries, null state, and ready status when runner is null', () => {
    const { result } = renderHook(() => useAgent(null, null));
    expect(result.current.entries).toEqual([]);
    expect(result.current.state).toBeNull();
    expect(result.current.status).toBe('ready');
  });

  it('returns initialState as state when provided', () => {
    const state = createMockState();
    const { result } = renderHook(() => useAgent(null, state));
    expect(result.current.state).toBe(state);
  });

  it('returns ready status by default with runner', () => {
    const runner = createMockRunner();
    const state = createMockState();
    const { result } = renderHook(() => useAgent(runner as unknown, state));
    expect(result.current.status).toBe('ready');
  });

  // -------------------------------------------------------------------------​
  // sendMessage — early return
  // -------------------------------------------------------------------------​

  it('sendMessage does nothing when runner is null', async () => {
    const { result } = renderHook(() => useAgent(null, createMockState()));
    await act(async () => {
      await result.current.sendMessage('hello');
    });
    expect(result.current.entries).toEqual([]);
  });

  it('sendMessage does nothing when state is null', async () => {
    const runner = createMockRunner();
    const { result } = renderHook(() => useAgent(runner as unknown, null));
    await act(async () => {
      await result.current.sendMessage('hello');
    });
    expect(result.current.entries).toEqual([]);
    expect(runner.runStream).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------​
  // sendMessage — happy path
  // -------------------------------------------------------------------------​

  it('sendMessage adds user entry and calls runStream', async () => {
    const runner = createMockRunner();
    const state = createMockState();
    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('hello agent');
    });

    expect(mockAddUserMessage).toHaveBeenCalledWith(state, 'hello agent');
    expect(runner.runStream).toHaveBeenCalled();

    expect(result.current.entries.length).toBeGreaterThanOrEqual(1);
    const userEntry = result.current.entries.find((e) => e.type === 'user');
    expect(userEntry).toBeDefined();
    if (userEntry && userEntry.type === 'user') {
      expect(userEntry.content).toBe('hello agent');
    }
  });

  it('sendMessage processes stream events and adds entries from consumer', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    // Must provide stream events so the for-await loop iterates and calls consumer.consume
    mockStreamEvents = [{ type: 'text-delta', text: 'Hello!' }];
    mockConsumeResult = [
      {
        type: 'assistant',
        id: 'entry-1',
        seq: 1,
        content: 'Hello!',
        timestamp: Date.now(),
      } as TimelineEntry,
    ];

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('hi');
    });

    const assistant = result.current.entries.find((e) => e.type === 'assistant');
    expect(assistant).toBeDefined();
  });

  it('sendMessage flushes remaining consumer content after stream ends', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    mockConsumeResult = [];
    mockFlushResult = [
      {
        type: 'assistant',
        id: 'entry-flush',
        seq: 2,
        content: 'flushed content',
        timestamp: Date.now(),
        isStreaming: false,
      } as TimelineEntry,
    ];

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('hi');
    });

    const flushed = result.current.entries.find((e) => e.id === 'entry-flush');
    expect(flushed).toBeDefined();
  });

  it('sendMessage skips adding entries when flush returns empty', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    mockConsumeResult = [];
    mockFlushResult = [];

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('hi');
    });

    // Only user entry
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].type).toBe('user');
  });

  // -------------------------------------------------------------------------​
  // sendMessage — status transitions
  // -------------------------------------------------------------------------​

  it('sendMessage transitions status from running to ready', async () => {
    const runner = createMockRunner();
    const state = createMockState();
    mockStreamEvents = [{ type: 'text-delta', text: 'hi' }];

    const { result } = renderHook(() => useAgent(runner as unknown, state));
    expect(result.current.status).toBe('ready');

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.status).toBe('ready');
  });

  // -------------------------------------------------------------------------​
  // sendMessage — AbortError
  // -------------------------------------------------------------------------​

  it('sendMessage adds system message on AbortError', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockRunStreamError = abortErr;

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    const systemEntry = result.current.entries.find((e) => e.type === 'system');
    expect(systemEntry).toBeDefined();
    if (systemEntry && systemEntry.type === 'system') {
      expect(systemEntry.content).toBe('Run interrupted');
    }
    expect(result.current.status).toBe('ready');
  });

  // -------------------------------------------------------------------------​
  // sendMessage — generic error
  // -------------------------------------------------------------------------​

  it('sendMessage adds error entry on generic Error', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    mockRunStreamError = new Error('LLM connection failed');

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    const errorEntry = result.current.entries.find((e) => e.type === 'error');
    expect(errorEntry).toBeDefined();
    if (errorEntry && errorEntry.type === 'error') {
      expect(errorEntry.message).toBe('LLM connection failed');
    }
    expect(result.current.status).toBe('ready');
  });

  it('sendMessage handles non-Error thrown value', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    // Override the mock to throw a non-Error (string)
    runner.runStream.mockImplementation(() => {
      return (async function* () {
        throw 'something went wrong';
      })();
    });

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    const errorEntry = result.current.entries.find((e) => e.type === 'error');
    expect(errorEntry).toBeDefined();
    if (errorEntry && errorEntry.type === 'error') {
      expect(errorEntry.message).toBe('something went wrong');
    }
  });

  // -------------------------------------------------------------------------​
  // abort
  // -------------------------------------------------------------------------​

  it('abort resets status to ready', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    // Make the stream hang so we can abort mid-flight
    let resolveStream: () => void;
    runner.runStream.mockImplementation(() => {
      return (async function* () {
        await new Promise<void>((resolve) => {
          resolveStream = resolve;
        });
        yield { type: 'text-delta', text: 'done' };
      })();
    });

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    // Start the send — will hang
    let sendPromise: Promise<void>;
    act(() => {
      sendPromise = result.current.sendMessage('hello');
    });

    // Give the async generator a tick to start
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Now abort
    act(() => {
      result.current.abort();
    });

    // Resolve the stream so the send can complete
    resolveStream!();

    await act(async () => {
      await sendPromise;
    });

    expect(result.current.status).toBe('ready');
  });

  // -------------------------------------------------------------------------​
  // Ref sync — state initialization guard
  // -------------------------------------------------------------------------​

  it('does not overwrite stateRef when initialState was previously set', () => {
    const runner = createMockRunner();
    const state = createMockState();

    const { result, rerender } = renderHook(
      ({ runner, initialState }: { runner: unknown; initialState: unknown }) =>
        useAgent(runner as any, initialState as any),
      { initialProps: { runner, initialState: state } }
    );

    expect(result.current.state).toBe(state);

    // Rerender with null initialState — guard prevents overwrite
    rerender({ runner, initialState: null });
    expect(result.current.state).toBe(state);
  });

  it('syncs runner ref on re-render', async () => {
    const runner1 = createMockRunner();
    const runner2 = createMockRunner();
    const state = createMockState();

    const { result, rerender } = renderHook(
      ({ runner, initialState }: { runner: unknown; initialState: unknown }) =>
        useAgent(runner as any, initialState as any),
      { initialProps: { runner: runner1, initialState: state } }
    );

    // Rerender with new runner
    rerender({ runner: runner2, initialState: state });

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(runner2.runStream).toHaveBeenCalled();
    expect(runner1.runStream).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------​
  // sendMessage — entries seq number
  // -------------------------------------------------------------------------​

  it('sendMessage captures correct entries.length at call time', async () => {
    const runner = createMockRunner();
    const state = createMockState();

    const { result } = renderHook(() => useAgent(runner as unknown, state));

    await act(async () => {
      await result.current.sendMessage('first');
    });

    expect(result.current.entries).toHaveLength(1);

    await act(async () => {
      await result.current.sendMessage('second');
    });

    const userEntries = result.current.entries.filter((e) => e.type === 'user');
    expect(userEntries).toHaveLength(2);
    if (userEntries[1] && userEntries[1].type === 'user') {
      expect(userEntries[1].content).toBe('second');
    }
  });
});
