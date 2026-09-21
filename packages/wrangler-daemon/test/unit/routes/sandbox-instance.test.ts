/**
 * withSandboxInstance 的包边界纪律测试：undefined 值的键不得传进
 * Sandbox 构造——包内用 {...DEFAULT_CONFIG, ...options} 合并，显式
 * undefined 会击穿默认值（timeout: undefined → setTimeout(fn, undefined)
 * = 0ms → 每条沙箱命令瞬间超时）。config.yaml 不写 sandbox 段的默认
 * 路径（mergeSandboxConfig 物化 timeout: undefined）正中此坑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ctorCalls: Array<Record<string, unknown>> = [];
vi.mock('@agentskillmania/sandbox', () => {
  return {
    Sandbox: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
      ctorCalls.push({ ...opts });
      return { __mock: true };
    }),
    TimeoutError: class extends Error {},
  };
});

import { withSandboxInstance } from '../../../src/routes/chat.js';

describe('withSandboxInstance: Sandbox 包边界纪律', () => {
  beforeEach(() => {
    ctorCalls.length = 0;
  });

  it('默认路径（无 config.yaml sandbox 段）不把 timeout: undefined 传给 Sandbox', () => {
    const merged = withSandboxInstance(undefined, undefined, '/tmp/ws');
    expect(merged.enabled).toBe(true);
    expect(ctorCalls).toHaveLength(1);
    const opts = ctorCalls[0];
    // 关键断言：不得存在值为 undefined 的键（会让包内默认 600s 失效）。
    for (const [k, v] of Object.entries(opts)) {
      expect(v).not.toBeUndefined();
    }
    expect('timeout' in opts).toBe(false);
  });

  it('显式配置透传（timeout/allowNetwork 有值时保留）', () => {
    withSandboxInstance(
      { enabled: true, timeout: 12345, allowNetwork: true },
      undefined,
      '/tmp/ws'
    );
    const opts = ctorCalls[0];
    expect(opts.timeout).toBe(12345);
    expect(opts.allowNetwork).toBe(true);
  });

  it('部分覆盖（body 有值）+ 部分缺省（base 无值）仍不产生 undefined 键', () => {
    withSandboxInstance(
      { enabled: true, timeout: undefined, allowNetwork: undefined },
      { timeout: 999 },
      '/tmp/ws'
    );
    const opts = ctorCalls[0];
    expect(opts.timeout).toBe(999);
    expect('allowNetwork' in opts).toBe(false);
  });

  it('禁用分支剥离实例', () => {
    const merged = withSandboxInstance(undefined, false, '/tmp/ws');
    expect(merged.enabled).toBe(false);
    expect('instance' in merged).toBe(false);
    expect(ctorCalls).toHaveLength(0);
  });
});
