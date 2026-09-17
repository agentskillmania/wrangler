import { describe, it, expect } from 'vitest';
import {
  createAgentState,
  addUserMessage,
  addAssistantMessage,
  serializeState,
  deserializeState,
} from '@agentskillmania/colts';

import { truncateStateTurns } from '../../../src/session/truncate.js';

// 按轮截断纯函数（R2P-154a，对齐 Rust 0a2cc4e session::truncate_state_turns
// 的单测逐条对照：轮边界、头部第 0 段防御保留、钳制幂等、todoList 删键、
// 统计/计费字段永不动、空会话 resume 往返）。

function msg(role: string, content: string): { role: string; content: string } {
  return { role, content };
}

function stateWith(messages: Array<{ role: string; content: string }>): string {
  return JSON.stringify({ id: 's1', context: { messages } });
}

function contents(json: string): string[] {
  const v = JSON.parse(json) as { context?: { messages?: Array<{ content: string }> } };
  return (v.context?.messages ?? []).map((m) => m.content);
}

describe('truncateStateTurns', () => {
  it('keeps the first N turns (turn = user message + trailing non-user)', () => {
    // 3 轮:u1/a1 | u2/a2 | u3/a3
    const out = truncateStateTurns(
      stateWith([
        msg('user', 'u1'),
        msg('assistant', 'a1'),
        msg('user', 'u2'),
        msg('assistant', 'a2'),
        msg('user', 'u3'),
        msg('assistant', 'a3'),
      ]),
      2
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.keptTurns).toBe(2);
    expect(contents(out.state.json)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('keepTurns=0 clears all turns but keeps the defensive head segment', () => {
    const out = truncateStateTurns(
      stateWith([msg('system', 'head'), msg('user', 'u1'), msg('assistant', 'a1')]),
      0
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.keptTurns).toBe(0);
    // 第 0 段(首条 user 前的非 user 消息)任何 keepTurns 下都保留——纯防御。
    expect(contents(out.state.json)).toEqual(['head']);
  });

  it('keepTurns beyond total turns is an idempotent no-op for messages', () => {
    const out = truncateStateTurns(stateWith([msg('user', 'u1'), msg('assistant', 'a1')]), 9);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.keptTurns).toBe(1);
    expect(contents(out.state.json)).toEqual(['u1', 'a1']);
  });

  it('same keepTurns applied twice changes nothing (idempotent)', () => {
    const raw = stateWith([
      msg('user', 'u1'),
      msg('assistant', 'a1'),
      msg('user', 'u2'),
      msg('assistant', 'a2'),
    ]);
    const first = truncateStateTurns(raw, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = truncateStateTurns(first.state.json, 1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.json).toBe(first.state.json);
    expect(second.state.keptTurns).toBe(1);
  });

  it('bundles tool/system trailing messages with their opening user message', () => {
    // 轮内不只有 assistant:tool/system 尾随消息随轮一起丢弃。
    const out = truncateStateTurns(
      stateWith([
        msg('user', 'u1'),
        msg('assistant', 'a1'),
        msg('tool', 't1'),
        msg('user', 'u2'),
        msg('assistant', 'a2'),
      ]),
      1
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(contents(out.state.json)).toEqual(['u1', 'a1', 't1']);
  });

  it('malformed entries (non-user / missing role) never open a turn', () => {
    const out = truncateStateTurns(
      stateWith([msg('user', 'u1'), msg('assistant', 'a1'), 'garbage', 42]),
      0
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.keptTurns).toBe(0);
    expect(contents(out.state.json)).toEqual([]);
  });

  it('drops context.todoList but keeps stats/billing and all other fields (Rust 对照)', () => {
    const raw = JSON.stringify({
      id: 's1',
      config: { name: 't', instructions: '', tools: [] },
      usage: { totalTokens: 12345 },
      context: {
        messages: [msg('user', 'u1'), msg('assistant', 'a1'), msg('user', 'u2')],
        stepCount: 7,
        totalTokens: { input: 99, output: 5 },
        estimatedContextSize: 4321,
        todoList: { items: [{ id: 1, subject: 'task', status: 'pending' }], nextId: 2 },
      },
    });
    const out = truncateStateTurns(raw, 1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const v = JSON.parse(out.state.json) as {
      id: string;
      usage: { totalTokens: number };
      context: Record<string, unknown> & {
        stepCount: number;
        totalTokens: { input: number; output: number };
        estimatedContextSize: number;
      };
    };
    expect('todoList' in v.context).toBe(false); // todoList 删键
    expect(v.context.stepCount).toBe(7); // 统计字段不动
    expect(v.context.totalTokens).toEqual({ input: 99, output: 5 }); // 计费不动
    expect(v.context.estimatedContextSize).toBe(4321);
    expect(v.usage.totalTokens).toBe(12345);
    expect(v.id).toBe('s1');
    expect(contents(out.state.json)).toEqual(['u1', 'a1']);
  });

  it('still drops todoList when keepTurns clamps to a message no-op (Rust parity)', () => {
    // Rust 语义:钳制只作用于 messages retain;todoList 删键无条件执行。
    const raw = stateWith([msg('user', 'u1'), msg('assistant', 'a1')]);
    const withTodo = JSON.stringify({
      ...JSON.parse(raw),
      context: { ...JSON.parse(raw).context, todoList: { items: [], nextId: 1 } },
    });
    const out = truncateStateTurns(withTodo, 9);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const v = JSON.parse(out.state.json) as { context: Record<string, unknown> };
    expect('todoList' in v.context).toBe(false);
    expect(contents(out.state.json)).toEqual(['u1', 'a1']);
  });

  it('leaves context.compression (anchor included) untouched — Rust 对照', () => {
    // Rust truncate 对 compression 既不删键也不钳制 anchor(0a2cc4e 与
    // HEAD 皆然)——TS 对齐为完全不动。消费侧天然安全:assembler 的活区
    // 循环上限 clamp 到 messages.length,越界 anchor 只会让本轮活区为空、
    // 摘要照发;下一次压缩自行重算边界。
    const compression = { summary: 'earlier turns summarized', anchor: 5, summaryTokenCount: 30 };
    const raw = JSON.stringify({
      id: 's1',
      context: {
        messages: [
          msg('user', 'u1'),
          msg('assistant', 'a1'),
          msg('user', 'u2'),
          msg('assistant', 'a2'),
        ],
        compression,
      },
    });
    const out = truncateStateTurns(raw, 1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const v = JSON.parse(out.state.json) as { context: { compression?: unknown } };
    expect(v.context.compression).toEqual(compression);
  });

  it('missing context or messages degrades to a no-op', () => {
    const out = truncateStateTurns(JSON.stringify({ id: 's1' }), 3);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.keptTurns).toBe(0);
    expect(JSON.parse(out.state.json)).toEqual({ id: 's1' });
  });

  it('invalid JSON is an error (never overwrite the original file)', () => {
    const out = truncateStateTurns('not json', 1);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain('invalid state JSON');
  });

  /**
   * keepTurns=0(编辑/重发首轮)的最敏感路径:截空后的 state 必须仍能被
   * colts `deserializeState` 解析成 AgentState,并在其上追加新 user 消息
   * —— 这就是空 context resume 通路的形状(colts 的初始状态本就是空
   * context,不存在「非空才 resume」的假设,这里把它钉成回归测试;
   * daemon /truncate 的 loadState 恢复也走同一条路)。
   */
  it('truncated state roundtrips and accepts a new user message', () => {
    let state = createAgentState({ name: 't', instructions: '', tools: [] });
    state = addUserMessage(state, 'q1');
    state = addAssistantMessage(state, 'a1');
    const raw = serializeState(state);

    const out = truncateStateTurns(raw, 0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const v = JSON.parse(out.state.json) as { context: { messages: unknown[] } };
    expect(v.context.messages).toEqual([]); // keepTurns=0 clears messages

    const reloaded = deserializeState(out.state.json);
    const next = addUserMessage(reloaded, 'edited');
    expect(next.context.messages).toHaveLength(1);
    expect(next.context.messages[0]!.content).toBe('edited');
    expect(next.context.messages[0]!.role).toBe('user');
  });
});
