import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { AgentSession } from '../../src/core/agent-session.js';

/**
 * 契约快照消费测试（返修 P2-2）——防 colts emitter ↔ daemon mapEvent 两端
 * 漂移：快照由 colts scripts/export-contracts.mjs 生成（单一生成源），本测
 * 试断言其 25 事件与 AgentSession.mapEvent 的输出事件名集合一致。
 *
 * 快照目录（../../../../../契约快照）在 agentskillmania 仓外且非 git 跟踪
 * ——CI 无该目录时 skip 不 fail（目录缺失不是回归）。
 */

/** 快照文件绝对路径（测试文件起 5 级上溯到 agentskillmania 根）。 */
const SNAPSHOT_PATH = fileURLToPath(
  new URL('../../../../../契约快照/events.json', import.meta.url)
);

/**
 * kernel 事件名 → daemon wire 事件名的完整对照（mapEvent 翻译表的可执行
 * 快照）。colts 加/改名事件、或 mapEvent 改翻译，本表两端任一漂移都会红。
 * run:start/run:end/waiting-human 走 default 直通（daemon 不订阅 run:*；
 * waiting-human 生产上只作为 complete.result.type 到达，不是独立事件）。
 */
const KERNEL_TO_WIRE: Record<string, string[]> = {
  abort: ['abort'],
  complete: ['done'],
  compressed: ['compressed'],
  compressing: ['compressing'],
  error: ['error'],
  'llm:request': ['llm-request'],
  'llm:response': ['llm-response'],
  'phase-change': ['phase-change'],
  'run:end': ['run:end'],
  'run:start': ['run:start'],
  'session-cleared': ['session-cleared'],
  'skill:end': ['skill-end'],
  'skill:loaded': ['skill-loaded'],
  'skill:loading': ['skill-loading'],
  'skill:start': ['skill-start'],
  'step:end': ['step-end'],
  'step:start': ['step-start'],
  thinking: ['thinking'],
  'todo:list': ['todo-list'],
  token: ['token'],
  'tool:end': ['tool-end'],
  'tool:start': ['tool-start'],
  'tools:end': ['tool-end'],
  'tools:start': ['tool-start'],
  'waiting-human': ['waiting-human'],
};

/** 每 kernel 类型的最小合成载荷——够 mapEvent 走完不抛、产出事件名。 */
const SYNTHETIC_PAYLOADS: Record<string, unknown> = {
  'step:start': { step: 1 },
  'step:end': { step: 1, result: {} },
  'phase-change': { from: 'a', to: 'b' },
  token: { token: 'x' },
  thinking: { content: 'x' },
  'tool:start': { action: { id: 'i', tool: 't', arguments: {} } },
  'tools:start': { actions: [{ id: 'i', tool: 't', arguments: {} }] },
  'tool:end': { callId: 'c', result: 'r' },
  'tools:end': { results: { c: 'r' } },
  'skill:loading': { name: 's' },
  'skill:loaded': { name: 's', tokenCount: 1 },
  'skill:start': { name: 's', task: 't' },
  'skill:end': { name: 's', result: 'r' },
  'llm:request': { messages: [], tools: [], model: 'm', contextWindow: 1 },
  'llm:response': { text: 't', toolCalls: [], tokens: {} },
  'todo:list': { items: [] },
  compressing: {},
  compressed: { summary: 's', removedCount: 1, coveredMessages: 1 },
  'session-cleared': {},
  complete: { result: {} },
  error: { error: { message: 'm' } },
  abort: { step: 1, totalSteps: 1 },
};

describe.skipIf(!existsSync(SNAPSHOT_PATH))('contract snapshot events.json (P2-2)', () => {
  it('25 kernel events map 1:1 onto mapEvent wire names (no drift either side)', async () => {
    const fixture = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf-8')) as {
      eventNames: string[];
      events: Record<string, { fields: string[] }>;
      daemonInjected?: Record<string, string>;
    };

    // 快照事件名集合与对照表严格一致（colts 侧增/改名 → 红）。
    expect(new Set(fixture.eventNames)).toEqual(new Set(Object.keys(KERNEL_TO_WIRE)));
    expect(fixture.eventNames.length).toBe(25);

    // 对照表逐项经真实 mapEvent 验证（daemon 侧改翻译 → 红）。
    for (const [kernel, expectedWire] of Object.entries(KERNEL_TO_WIRE)) {
      const mapped = AgentSession.mapEvent({
        type: kernel,
        ...SYNTHETIC_PAYLOADS[kernel],
      } as { type: string });
      const produced = (Array.isArray(mapped) ? mapped : [mapped]).map((m) => m.event);
      expect(produced, `mapEvent(${kernel})`).toEqual(expectedWire);
    }
  });

  it('daemon-injected fields live in the generator-owned daemonInjected section, not fields', async () => {
    const fixture = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf-8')) as {
      events: Record<string, { fields: string[] }>;
      daemonInjected?: Record<string, string>;
    };

    // seq/turnSeq 是 daemon 层 wire 注入（R2P-151/152），由 exporter 的
    // daemonInjected 小节持有（复跑不丢）；混进 fields 会随复跑还原且
    // 污染 emitter 语义——出现即红。
    expect(Object.keys(fixture.daemonInjected ?? {}).sort()).toEqual(['seq', 'turnSeq']);
    for (const [name, ev] of Object.entries(fixture.events)) {
      expect(ev.fields, `${name}.fields`).not.toContain('seq');
      expect(ev.fields, `${name}.fields`).not.toContain('turnSeq');
    }
  });
});
