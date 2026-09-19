/**
 * @fileoverview SubagentSupervisor —— 会话的异步委派监督者（R2P-141a）。
 *
 * 对齐 Rust crates/wrangler/src/session/supervisor.rs：
 * 受理 delegate 工具上交的子任务（登记 + 并发闸门 + 后台驱动）、看门狗
 * 超时（超时的子任务按 timeout 结果投递，会话重获冷却资格）、子完成时把
 * 结果经 hooks.deliver 投递进会话邮箱、取消级联（/stop——abort 全部子女，
 * 不投递）。子女计数进冷却资格（daemon 侧 sweepIdleAgentSessions 的
 * hasActiveChildren 臂）。
 *
 * 槽语义（对齐 Rust SupervisorSlot）：监督者经 EnhancedRunner 的
 * delegateSupervisorSlot 晚绑定——槽空 = delegate 同步阻塞到完成
 * （devtool/裸 runner 的默认，零变化）；槽内有活监督者（daemon 会话
 * 物化时绑定）= 受理即返回 accepted 回执。
 *
 * 并发上限 16（DEFAULT_MAX_CHILDREN，Rust b9171bd 起 4 → 16）：超出的
 * 子女登记在册（钉住冷却资格）但在闸门内排队——排队者不拒绝。
 *
 * 生命周期：由会话实体（daemon AgentSession）创建并 bind（hooks 持会话
 * 侧投递/写帧闭包）；进程重启子女丢失（进程内任务），已投递的邮箱在盘
 * 存活（deliveries.json sidecar），下次物化时消费——崩溃语义与会话一致。
 */

import type { PendingDelivery } from './types.js';
import type { DelegateResult } from '../subagent/types.js';

/** 子女的默认看门狗超时：10 分钟（对齐 Rust DEFAULT_CHILD_TIMEOUT）。 */
export const DEFAULT_CHILD_TIMEOUT_MS = 10 * 60 * 1000;

/** 子女并发上限（对齐 Rust DEFAULT_MAX_CHILDREN = 16）。 */
export const DEFAULT_MAX_CHILDREN = 16;

/**
 * 会话侧挂钩（晚绑定，对齐 Rust Supervisor 的 Weak 回指）：
 * - deliver：子完成时的投递入口（写会话邮箱 + 唤醒消费）；
 * - emit：子任务 Subagent* 帧的写口（走会话通道——落史+序号+广播
 *   同一条路，轮外也可见）。
 */
export interface SupervisorHooks {
  deliver(delivery: PendingDelivery): void;
  emit(type: string, data: Record<string, unknown>): void;
}

/** 子任务帧写口（supervisor.eventSink 的返回形状）。 */
export type EventSink = (type: string, data: Record<string, unknown>) => void;

/** 一件待驱动的子任务（对齐 Rust DelegationJob）。 */
export interface DelegationJob {
  subtaskId: string;
  agent: string;
  task: string;
  /**
   * 完整的驱动闭包：Subagent* 帧转发（经 emitFn）与 DelegateResult 映射
   * 已内嵌，监督者只需推到完成。signal = 看门狗/取消级联的 AbortSignal；
   * 子代理配置里的 timeout（AbortSignal 路径）由 run 内部自管——两者
   * 先到先生效（对齐 Rust「双重强制」）。
   */
  run: (signal: AbortSignal) => Promise<DelegateResult>;
}

/**
 * 异步委派监督者接口（对齐 Rust DelegateSupervisor trait）。
 * 有监督者时 delegate 工具「受理即返回」；isAlive=false 时 handler
 * 回落同步模式——监督者失活不应吞掉委派。
 */
export interface DelegateSupervisor {
  /** 会话还活着（hooks 已绑定）。false 时 handler 回落同步模式。 */
  isAlive(): boolean;
  /** 子任务 Subagent* 帧的写口。null = 会话已逝（兜底父通道）。 */
  eventSink(): EventSink | null;
  /** 受理一件子任务：登记 + 后台驱动；完成时注销登记并投递。 */
  accept(job: DelegationJob): void;
}

/**
 * 监督者槽（对齐 Rust SupervisorSlot = RwLock<Option<Arc<dyn ...>>>）：
 * runner 构建时创建（空 = 同步模式默认），会话物化后由宿主晚绑定。
 * handler 每次调用时读槽。
 */
export type SupervisorSlot = { current: DelegateSupervisor | null };

/** 空槽（同步模式，runner 构造的默认）。 */
export function emptySupervisorSlot(): SupervisorSlot {
  return { current: null };
}

/** 登记簿条目：取消级联用的中止口 + 看门狗计时起点。 */
interface ChildEntry {
  abort: AbortController;
  startedAt: number;
}

/** 闸门排队者：permit 释放时按 FIFO 放行；排队中被叫停则取消。 */
interface GateWaiter {
  proceed: () => void;
  cancel: () => void;
}

/**
 * 见模块文档。单线程 JS 下 Rust 的 Mutex/Semaphore 塌缩为普通字段 +
 * FIFO 等待队列；受理路径的登记（children.set）在 accept 返回前同步
 * 完成——冷却资格的「子女在飞」从受理那一刻起即真。
 */
export class SubagentSupervisor implements DelegateSupervisor {
  private hooks: SupervisorHooks | null = null;
  /** 子女登记簿：subtask_id → 中止口（取消级联用）。 */
  private readonly children = new Map<string, ChildEntry>();
  /** 并发闸门的在跑计数（上限见构造参数）。 */
  private running = 0;
  /** 闸门排队（FIFO；排队者已登记——钉住冷却资格）。 */
  private readonly waiters: GateWaiter[] = [];
  private readonly maxChildren: number;
  /** 看门狗超时（可配，测试用 setChildTimeout 覆盖）。 */
  private childTimeoutMs: number;
  /**
   * 取消代际（对齐 Rust cancel_epoch）：cancelAll 递增。已受理任务的
   * 收尾段（unregister→deliver 之间无 await 点，abort 打不断）据此弃投
   * ——/stop 之后不再冒出一轮消费。
   */
  private cancelEpoch = 0;

  constructor(options: { maxChildren?: number; childTimeoutMs?: number } = {}) {
    this.maxChildren = options.maxChildren ?? DEFAULT_MAX_CHILDREN;
    this.childTimeoutMs = options.childTimeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS;
  }

  /** 绑定会话挂钩（会话物化时调用；此前后面所有查询都是「死」的）。 */
  bind(hooks: SupervisorHooks): void {
    this.hooks = hooks;
  }

  isAlive(): boolean {
    return this.hooks !== null;
  }

  /**
   * 子任务帧写口：经 hooks.emit 走会话通道。未绑定时返回 null
   * （delegate handler 兜底父 runner 通道）。
   */
  eventSink(): EventSink | null {
    if (!this.hooks) return null;
    return (type, data) => {
      this.hooks?.emit(type, data);
    };
  }

  /** 进行中子任务数（冷却资格 = 轮完 且 子女清零 且 邮箱空）。 */
  childCount(): number {
    return this.children.size;
  }

  /** 冷却资格的「子女在飞」只读查询（daemon sweep 谓词用）。 */
  hasActiveChildren(): boolean {
    return this.children.size > 0;
  }

  /** 覆盖看门狗超时（宿主配置/测试）。 */
  setChildTimeout(ms: number): void {
    this.childTimeoutMs = ms;
  }

  private unregister(subtaskId: string): void {
    this.children.delete(subtaskId);
  }

  /**
   * 取消级联：先递增取消代际，再中止全部进行中/排队子女（被 abort 的
   * 子女不投递——用户叫停的语义是「别再来了」；已过最后一个 await、正在
   * 同步收尾的子女由代际判定弃投）。
   */
  cancelAll(): void {
    this.cancelEpoch += 1;
    for (const entry of this.children.values()) {
      entry.abort.abort();
    }
    this.children.clear();
  }

  /**
   * 受理一件子任务：同步登记（钉住冷却资格）+ 后台驱动。
   * 完成路径：闸门放行 → 看门狗包裹 run → 注销 → 代际检查 → 投递。
   * run 抛错按 error 结果投递（驱动失败不静默）；看门狗到点把 outcome
   * 替换成 timeout 形状（run 经 signal 中止）。
   */
  accept(job: DelegationJob): void {
    if (!this.hooks) {
      return; // isAlive 已挡；这里是与判定的竞态双保险
    }
    const id = job.subtaskId;
    const entry: ChildEntry = { abort: new AbortController(), startedAt: Date.now() };
    this.children.set(id, entry);
    const epochAtAccept = this.cancelEpoch;
    void (async () => {
      // 并发闸门：超出上限的子女在此排队（已登记，钉住冷却资格）；
      // 排队中被叫停（cancelAll abort 信号）直接退出，不占 permit。
      const got = await this.acquirePermit(entry.abort.signal);
      try {
        if (!got) {
          return; // 排队中被叫停——登记簿已被 cancelAll 清空
        }
        if (this.cancelEpoch !== epochAtAccept) {
          return; // 放行瞬间已被叫停（防御；abort 打不断同步段）
        }
        // 看门狗：超时即 abort run（子 runner 的 LLM 调用随 signal 解栈），
        // 按 timeout 结果投递。
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          entry.abort.abort();
        }, this.childTimeoutMs);
        let outcome: DelegateResult;
        try {
          outcome = await job.run(entry.abort.signal);
        } catch (err) {
          outcome = errorOutcome(err, entry.startedAt);
        } finally {
          clearTimeout(timer);
        }
        this.unregister(id);
        // 取消代际已翻 = 受理之后用户叫停过。收尾段没有 await 点、abort
        // 打不断，这里主动弃投（unregister 幂等，条目多半已被 clear）。
        if (this.cancelEpoch !== epochAtAccept) {
          return;
        }
        if (timedOut) {
          outcome = watchdogOutcome(this.childTimeoutMs);
        }
        this.hooks?.deliver(toDelivery(job, outcome));
      } finally {
        if (got) {
          this.releasePermit();
        }
      }
    })();
  }

  /**
   * 取一张并发闸门 permit：有空位立即放行；否则排队（FIFO）。排队期间
   * signal 被 abort（取消级联）则返回 false——排队者退出，不占 permit。
   */
  private acquirePermit(signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      if (this.running < this.maxChildren) {
        this.running += 1;
        resolve(true);
        return;
      }
      const waiter: GateWaiter = {
        // permit 被让渡（releasePermit 直接移交给队首）：计数不变——
        // 离场者与入场者各一，running 净变化为 0；只有「真归还」
        // （无排队者）才 running--。
        proceed: () => {
          cleanup();
          resolve(true);
        },
        cancel: () => {
          cleanup();
          resolve(false);
        },
      };
      const cleanup = (): void => {
        signal.removeEventListener('abort', waiter.cancel);
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) {
          this.waiters.splice(i, 1);
        }
      };
      this.waiters.push(waiter);
      signal.addEventListener('abort', waiter.cancel, { once: true });
    });
  }

  /** 释放一张 permit：优先让渡给队首排队者，无排队者才真正归还。 */
  private releasePermit(): void {
    const next = this.waiters.shift();
    if (next) {
      next.proceed();
    } else {
      this.running -= 1;
    }
  }
}

/** 看门狗超时的投递形状（对齐 Rust supervisor.rs 的 timeout JSON）。 */
export function watchdogOutcome(timeoutMs: number): DelegateResult {
  return {
    status: 'timeout',
    error: `watchdog timeout after ${timeoutMs}ms`,
    partialResult: '',
    totalSteps: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    duration: timeoutMs,
  };
}

/** run 抛错（驱动失败）的兜底形状——不静默，按 error 投递。 */
export function errorOutcome(err: unknown, startedAt: number): DelegateResult {
  return {
    status: 'error',
    error: err instanceof Error ? err.message : String(err),
    totalSteps: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    duration: Date.now() - startedAt,
  };
}

/**
 * 从 DelegateResult 提取投递正文：成功取 answer，错误取 error，超时取
 * partialResult，max_steps 取 lastAnswer，其余兜底整个 JSON 的串
 * （对齐 Rust delivery_content 的优先序）。
 */
export function deliveryContent(outcome: DelegateResult): string {
  const o = outcome as unknown as Record<string, unknown>;
  for (const key of ['answer', 'error', 'partialResult', 'lastAnswer']) {
    const v = o[key];
    if (typeof v === 'string' && v !== '') {
      return v;
    }
  }
  return JSON.stringify(outcome);
}

/** job + outcome → 邮箱条目（camelCase，deliveries.json sidecar 形状）。 */
function toDelivery(job: DelegationJob, outcome: DelegateResult): PendingDelivery {
  return {
    subtaskId: job.subtaskId,
    agent: job.agent,
    content: deliveryContent(outcome),
    status: outcome.status,
    completedAt: Date.now(),
  };
}
