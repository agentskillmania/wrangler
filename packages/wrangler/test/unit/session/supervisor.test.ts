/**
 * @fileoverview SubagentSupervisor unit tests（R2P-141a，对齐 Rust
 * crates/wrangler/src/session/supervisor.rs 的测试面）。
 *
 * 受理/登记/投递/注销闭环、并发闸门排队（不拒绝）、看门狗超时投递、
 * 取消级联不投递、代际弃投、未绑定判死、deliveryContent 优先序。
 */

import { describe, it, expect, vi } from 'vitest';

import {
  SubagentSupervisor,
  DEFAULT_MAX_CHILDREN,
  DEFAULT_CHILD_TIMEOUT_MS,
  deliveryContent,
  emptySupervisorSlot,
} from '../../../src/session/supervisor.js';
import type { DelegationJob, SupervisorHooks } from '../../../src/session/supervisor.js';
import type { DelegateResult } from '../../../src/subagent/types.js';

const zeroTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function success(answer: string): DelegateResult {
  return { status: 'success', answer, totalSteps: 1, tokens: zeroTokens, duration: 5 };
}

/** 挂起直到 signal abort 的 run——看门狗/取消测试的「卡死子女」。 */
function neverResolving(): DelegationJob['run'] {
  return (signal) =>
    new Promise<DelegateResult>((resolve) => {
      signal.addEventListener('abort', () =>
        resolve({ status: 'abort', totalSteps: 0, tokens: zeroTokens, duration: 0 })
      );
    });
}

function makeHooks(): SupervisorHooks & {
  deliveries: import('../../../src/session/types.js').PendingDelivery[];
  events: Array<[string, Record<string, unknown>]>;
} {
  const deliveries: import('../../../src/session/types.js').PendingDelivery[] = [];
  const events: Array<[string, Record<string, unknown>]> = [];
  return {
    deliveries,
    events,
    deliver: (d) => deliveries.push(d),
    emit: (type, data) => events.push([type, data]),
  };
}

function job(id: string, run: DelegationJob['run'], agent = 'helper'): DelegationJob {
  return { subtaskId: id, agent, task: 'do X', run };
}

describe('SubagentSupervisor (R2P-141a)', () => {
  it('unbound supervisor is not alive: no sink, accept is a no-op', () => {
    const sup = new SubagentSupervisor();
    expect(sup.isAlive()).toBe(false);
    expect(sup.eventSink()).toBeNull();
    expect(() => sup.accept(job('x', async () => success('A')))).not.toThrow();
    expect(sup.childCount()).toBe(0);
  });

  it('emptySupervisorSlot starts with a null current (sync-mode default)', () => {
    const slot = emptySupervisorSlot();
    expect(slot.current).toBeNull();
  });

  it('accept registers synchronously, delivers on completion, then unregisters', async () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor();
    sup.bind(hooks);

    let release: (v: DelegateResult) => void = () => {};
    const gate = new Promise<DelegateResult>((resolve) => {
      release = resolve;
    });
    sup.accept(job('helper-1', () => gate));

    // 登记是同步的：受理那一刻「子女在飞」即真（钉住冷却资格）。
    expect(sup.childCount()).toBe(1);
    expect(sup.hasActiveChildren()).toBe(true);

    release(success('A-1'));
    await vi.waitFor(() => expect(hooks.deliveries.length).toBe(1));
    expect(sup.childCount()).toBe(0, 'completed child unregisters');

    const d = hooks.deliveries[0]!;
    expect(d.subtaskId).toBe('helper-1');
    expect(d.agent).toBe('helper');
    expect(d.status).toBe('success');
    expect(d.content).toBe('A-1', 'content = answer');
    expect(d.completedAt).toBeGreaterThan(0);
  });

  it('children beyond the cap queue at the permit gate — registered (pinned), not rejected', async () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor();
    sup.bind(hooks);

    const total = DEFAULT_MAX_CHILDREN + 2;
    const started: string[] = [];
    const releaseAll = new Promise<void>(() => {}); // 卡住 cap 内的子女
    for (let i = 0; i < total; i++) {
      const id = `c-${i}`;
      sup.accept(
        job(id, () => {
          started.push(id);
          return releaseAll.then(() => success('done'));
        })
      );
    }
    // 全部登记在册（排队者也钉住冷却资格）；在跑数恰好是 cap。
    expect(sup.childCount()).toBe(total);
    await vi.waitFor(() => expect(started.length).toBe(DEFAULT_MAX_CHILDREN));
    // 排队者尚未开跑——闸门内等待，不是拒绝。
    expect(started.length).toBe(DEFAULT_MAX_CHILDREN);
    expect(DEFAULT_MAX_CHILDREN).toBe(16, 'cap aligns Rust b9171bd (4 → 16)');
  });

  it('watchdog timeout delivers the timeout-shaped result and clears the registry', async () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor();
    sup.bind(hooks);
    sup.setChildTimeout(20);

    sup.accept(job('stuck-1', neverResolving()));

    await vi.waitFor(() => expect(hooks.deliveries.length).toBe(1));
    const d = hooks.deliveries[0]!;
    expect(d.subtaskId).toBe('stuck-1');
    expect(d.status).toBe('timeout');
    expect(d.content).toContain('watchdog timeout after 20ms');
    expect(sup.childCount()).toBe(0, 'watchdog 后子女清零（会话重获冷却资格）');
  });

  it('cancelAll aborts in-flight and queued children without delivery', async () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor({ maxChildren: 1 });
    sup.bind(hooks);

    sup.accept(job('running-1', neverResolving()));
    await vi.waitFor(() => expect(sup.childCount()).toBe(1));
    sup.cancelAll();

    expect(sup.childCount()).toBe(0, 'cancel drains the registry');
    await new Promise((r) => setTimeout(r, 50));
    expect(hooks.deliveries.length).toBe(0, 'aborted children do not deliver');
  });

  it('a child completing after cancelAll does not deliver (cancel-epoch drop)', async () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor();
    sup.bind(hooks);

    let release: (v: DelegateResult) => void = () => {};
    const gate = new Promise<DelegateResult>((resolve) => {
      release = resolve;
    });
    sup.accept(job('late-1', () => gate));
    await vi.waitFor(() => expect(sup.childCount()).toBe(1));

    // 子女完成（run future 已就绪，尚未进收尾段）与叫停竞速：叫停在前，
    // 收尾必须弃投。
    release(success('too late'));
    sup.cancelAll();

    await new Promise((r) => setTimeout(r, 50));
    expect(hooks.deliveries.length).toBe(0, 'no delivery after the user cancelled');
    expect(sup.childCount()).toBe(0);
  });

  it('a run that throws delivers an error-shaped result (not silent)', async () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor();
    sup.bind(hooks);

    sup.accept(
      job('boom-1', async () => {
        throw new Error('kaboom');
      })
    );

    await vi.waitFor(() => expect(hooks.deliveries.length).toBe(1));
    const d = hooks.deliveries[0]!;
    expect(d.status).toBe('error');
    expect(d.content).toBe('kaboom');
  });

  it('eventSink routes sub-agent frames through hooks.emit (session channel write)', () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor();
    sup.bind(hooks);
    const sink = sup.eventSink();
    expect(sink).not.toBeNull();

    sink!('subagent:start', { name: 'scout', task: 't', subtaskId: 'scout-1' });
    expect(hooks.events).toEqual([
      ['subagent:start', { name: 'scout', task: 't', subtaskId: 'scout-1' }],
    ]);
  });

  it('default watchdog timeout is 10 minutes (read from Rust DEFAULT_CHILD_TIMEOUT)', () => {
    expect(DEFAULT_CHILD_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it('deliveryContent prefers answer > error > partialResult > lastAnswer > JSON fallback', () => {
    expect(
      deliveryContent({
        status: 'success',
        answer: 'A',
        totalSteps: 0,
        tokens: zeroTokens,
        duration: 0,
      })
    ).toBe('A');
    expect(
      deliveryContent({
        status: 'error',
        error: 'E',
        totalSteps: 0,
        tokens: zeroTokens,
        duration: 0,
      })
    ).toBe('E');
    expect(
      deliveryContent({
        status: 'timeout',
        partialResult: 'P',
        totalSteps: 0,
        tokens: zeroTokens,
        duration: 0,
      })
    ).toBe('P');
    expect(
      deliveryContent({
        status: 'max_steps',
        lastAnswer: 'L',
        totalSteps: 0,
        tokens: zeroTokens,
        duration: 0,
      })
    ).toBe('L');
    // 空串跳过（对齐 Rust 的非空判定），落到 JSON 兜底。
    const bare = deliveryContent({
      status: 'timeout',
      partialResult: '',
      totalSteps: 0,
      tokens: zeroTokens,
      duration: 0,
    });
    expect(bare).toContain('"status":"timeout"');
  });

  it('permits are released after completion: capacity frees up for later children', async () => {
    const hooks = makeHooks();
    const sup = new SubagentSupervisor({ maxChildren: 1 });
    sup.bind(hooks);

    sup.accept(job('a-1', async () => success('first')));
    await vi.waitFor(() => expect(hooks.deliveries.length).toBe(1));

    sup.accept(job('a-2', async () => success('second')));
    await vi.waitFor(() => expect(hooks.deliveries.length).toBe(2));
    expect(sup.childCount()).toBe(0);
  });
});
