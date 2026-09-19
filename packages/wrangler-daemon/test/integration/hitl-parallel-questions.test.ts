import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SessionStore } from '@agentskillmania/wrangler';
import { defaultNodeHostEnv } from '@agentskillmania/wrangler/host-env/node-host-env';
import type { ILLMProvider } from '@agentskillmania/colts';

import { AgentSession } from '../../src/core/agent-session.js';
import type { DaemonConfig } from '../../src/types.js';
import type { SSEEvent } from '../../src/types.js';

/**
 * HITL daemon-layer integration (R2P-165): real AgentHarness + real colts
 * kernel + scripted LLM provider — no module mocks. Pins:
 *
 * 1. Parallel double-ask (one assistant message, two ask_human calls):
 *    SSE surfaces BOTH questions under DISTINCT collision-proof requestIds,
 *    each answer resolves exactly its own parked ask, and the run continues
 *    to success with both tool results paired (the provider-400 failure mode
 *    the old `human-${Date.now()}` ids produced).
 * 2. run()'s assertResumableState guard errors pass through the daemon SSE
 *    error frame verbatim (both tiers — pending interrupt / dangling call).
 * 3. State-tier respond (respondViaState) + continuation run (continueRun)
 *    drive a resumed turn without a new user message.
 */

// ─── Scripted LLM provider ─────────────────────────────────────────────

/** One turn = the events the fake provider yields for one stream() call. */
type Turn = Array<Record<string, unknown>>;

function scriptedProvider(turns: Turn[], calls: { messages: unknown[] }[] = []): ILLMProvider {
  let i = 0;
  return {
    async *stream(options: { messages: unknown[] }) {
      calls.push({ messages: options.messages });
      const turn = turns[Math.min(i++, turns.length - 1)];
      for (const event of turn) yield event as never;
    },
    getModelMeta: () => ({ contextWindow: 128000, maxTokens: 4096 }),
    call: async () => {
      throw new Error('call() is not expected in these tests (kernel streams)');
    },
  } as unknown as ILLMProvider;
}

const askTurn: Turn = [
  {
    type: 'tool_call',
    toolCall: {
      id: 'ask-1',
      name: 'ask_human',
      arguments: { questions: [{ id: 'q1', question: 'Name?', type: 'text' }] },
    },
  },
  {
    type: 'tool_call',
    toolCall: {
      id: 'ask-2',
      name: 'ask_human',
      arguments: {
        questions: [{ id: 'q2', question: 'Flavor?', type: 'single-select', options: ['a', 'b'] }],
      },
    },
  },
  { type: 'done', roundTotalTokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } },
];

const finalTurn: Turn = [
  { type: 'text', delta: 'Both answered, thanks.' },
  { type: 'done', roundTotalTokens: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0 } },
];

const testConfig = {
  llm: { providers: [] },
  server: { port: 3100, host: 'localhost' },
} satisfies DaemonConfig;

/** Drain a session stream, answering ask_human frames via the given resolver. */
async function drainWithAnswers(
  stream: AsyncIterable<SSEEvent>,
  session: AgentSession,
  answers: Record<string, unknown>
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const sse of stream) {
    events.push(sse);
    if (sse.event === 'human-input') {
      const data = sse.data as Record<string, unknown>;
      const questions = data.questions as Array<{ id: string }>;
      const response: Record<string, unknown> = {};
      for (const q of questions) response[q.id] = answers[q.id] ?? { type: 'direct', value: 'x' };
      expect(session.respondHumanInput(data.requestId as string, response)).toBe(true);
    }
  }
  return events;
}

describe('HITL parallel double-ask (daemon layer, R2P-165)', () => {
  let tempDir: string;
  let workspacePath: string;
  let sessionsBaseDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'daemon-hitl-'));
    workspacePath = join(tempDir, 'ws');
    sessionsBaseDir = join(tempDir, 'sessions');
    // Workspace-based store keyed by sessionId — AgentSession.create() loads
    // a previous state only when sessionId is given (the dir-bound store
    // rejects sessionIds).
    store = new SessionStore(sessionsBaseDir, workspacePath, defaultNodeHostEnv);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createSession(llmClient: ILLMProvider, sessionId?: string): Promise<AgentSession> {
    return AgentSession.create(
      {
        sessionId,
        workspacePath,
        agentName: 'test-agent',
        runtime: defaultNodeHostEnv,
        llmClient,
        sessionStore: store,
        sessionBaseDir: sessionsBaseDir,
        // Sandbox off — no host-constructed instance in tests (mirrors the
        // route's withSandboxInstance disabled branch).
        sandbox: false,
      },
      testConfig
    );
  }

  it('surfaces both questions under distinct UUID requestIds, answers resolve one-to-one, run continues', async () => {
    const calls: { messages: unknown[] }[] = [];
    const session = await createSession(scriptedProvider([askTurn, finalTurn], calls));

    const events = await drainWithAnswers(session.handleMessage('ask me two things'), session, {
      q1: { type: 'direct', value: 'Ada' },
      q2: { type: 'direct', value: 'b' },
    });

    // SSE 多问下发：两条 human-input 帧，requestId 互异且为 human-<uuid>。
    const humanFrames = events.filter((e) => e.event === 'human-input');
    expect(humanFrames).toHaveLength(2);
    const ids = humanFrames.map((f) => (f.data as Record<string, unknown>).requestId as string);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      expect(id).toMatch(/^human-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    // ③ additive requests array on every frame.
    for (const frame of humanFrames) {
      const requests = (frame.data as Record<string, unknown>).requests as unknown[];
      expect(requests).toHaveLength(1);
      expect((requests[0] as Record<string, unknown>).requestId).toBe(
        (frame.data as Record<string, unknown>).requestId
      );
    }

    // 续跑：第二轮 LLM 调用携带两个 tool 结果（配对保全）。
    const done = events.find((e) => e.event === 'done');
    expect((done?.data as Record<string, unknown>).type).toBe('success');
    expect(calls).toHaveLength(2);
    const secondCall = JSON.stringify(calls[1].messages);
    expect(secondCall).toContain('Ada');
    expect(secondCall).toContain('ask-1');
    expect(secondCall).toContain('ask-2');

    // 落盘（SessionMiddleware.afterRun）：两个 tool 结果都进了 state.json。
    const persisted = await store.loadState(session.getState().id);
    expect(persisted?.context.messages).toBeDefined();
    const toolResults = persisted!.context.messages.filter(
      (m: { role?: string }) => m.role === 'tool'
    );
    expect(toolResults).toHaveLength(2);
  });

  it('passes assertResumableState guard errors through the SSE error frame verbatim (both tiers)', async () => {
    // State whose last assistant row carries an unanswered ask_human call.
    // Tier A: the call IS in pendingInterrupts → "answer the pending…".
    // Tier B: the call is nowhere → "dangling tool_call … provider 400".
    // Both fire before any LLM call — provider throws if reached.
    const baseState = {
      id: 'guard-state',
      config: { name: 'test-agent', instructions: '', tools: [] },
      context: {
        messages: [
          { id: 'm1', role: 'user', content: 'hi', timestamp: 1 },
          {
            id: 'm2',
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call-x', name: 'ask_human', arguments: {} }],
            timestamp: 2,
          },
        ],
        stepCount: 1,
        createdAt: 1,
        updatedAt: 2,
      },
    };

    const pendingState = structuredClone(baseState);
    (pendingState.context as { pendingInterrupts?: unknown[] }).pendingInterrupts = [
      {
        request: {
          type: 'question',
          questions: [{ id: 'q1', question: '?', type: 'text' }],
          toolCallId: 'call-x',
        },
        createdAt: 3,
      },
    ];

    for (const [name, state, expectedText] of [
      ['pending-interrupt tier', pendingState, 'pending human interrupt'],
      ['dangling tool_call tier', baseState, 'dangling tool_call'],
    ] as const) {
      await store.createWithId('guard-state', 'test-agent');
      await store.saveState('guard-state', state as never);
      const session = await createSession(
        scriptedProvider([
          [
            {
              type: 'error',
              error: { errorMessage: 'LLM must not be called when the guard refuses' },
            },
          ],
        ]),
        'guard-state'
      );
      const events: SSEEvent[] = [];
      for await (const sse of session.handleMessage('continue')) events.push(sse);

      const errorFrame = events.find((e) => e.event === 'error');
      expect(errorFrame, name).toBeDefined();
      const message = (errorFrame!.data as { message: string }).message;
      // 原样透传：两档文案（先应答再续跑 / 悬挂 tool_call provider 400）。
      expect(message, name).toContain(expectedText);
      expect(message, name).toContain('call-x');
      expect(message, name).toContain('Unanswered tool call(s) on the last assistant message');
    }
  });

  it('respondViaState answers persisted interrupts stepwise, then continueRun resumes without a new user message', async () => {
    // Simulate a waiting-human terminal state as colts persists it: two
    // unanswered asks, one assistant row carrying both tool calls.
    const state = {
      id: 'waiting-state',
      config: { name: 'test-agent', instructions: '', tools: [] },
      context: {
        messages: [
          { id: 'm1', role: 'user', content: 'ask me', timestamp: 1 },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Two questions first.',
            toolCalls: [
              {
                id: 'call-1',
                name: 'ask_human',
                arguments: { questions: [{ id: 'q1', question: 'A?', type: 'text' }] },
              },
              {
                id: 'call-2',
                name: 'ask_human',
                arguments: { questions: [{ id: 'q2', question: 'B?', type: 'text' }] },
              },
            ],
            timestamp: 2,
          },
        ],
        stepCount: 1,
        createdAt: 1,
        updatedAt: 2,
        pendingInterrupts: [
          {
            request: {
              type: 'question',
              questions: [{ id: 'q1', question: 'A?', type: 'text' }],
              toolCallId: 'call-1',
            },
            createdAt: 3,
          },
          {
            request: {
              type: 'question',
              questions: [{ id: 'q2', question: 'B?', type: 'text' }],
              toolCallId: 'call-2',
            },
            createdAt: 4,
          },
        ],
      },
    };
    await store.createWithId('waiting-state', 'test-agent');
    await store.saveState('waiting-state', state as never);

    const calls: { messages: unknown[] }[] = [];
    const session = await createSession(scriptedProvider([finalTurn], calls), 'waiting-state');

    // 逐个应答：第一答余一（waiting，不触 LLM）。
    const first = await session.respondViaState('q1', { q1: { type: 'direct', value: 'A' } });
    expect(first.status).toBe('answered');
    expect(first.status === 'answered' && first.remaining).toHaveLength(1);
    expect(calls).toHaveLength(0);

    // 第二答清空清单并写穿磁盘。
    const second = await session.respondViaState('call-2', {
      q2: { type: 'direct', value: 'B' },
    });
    expect(second.status === 'answered' && second.remaining).toHaveLength(0);
    const persisted = await store.loadState('waiting-state');
    expect(persisted!.context.pendingInterrupts).toBeUndefined();

    // 续跑：无新用户消息，LLM 从注入的两个 tool 结果后继续。
    const events: SSEEvent[] = [];
    for await (const sse of session.continueRun()) events.push(sse);
    const done = events.find((e) => e.event === 'done');
    expect((done?.data as Record<string, unknown>).type).toBe('success');
    expect(calls).toHaveLength(1);
    const wire = JSON.stringify(calls[0].messages);
    expect(wire).toContain('call-1');
    expect(wire).toContain('call-2');
  });
});
