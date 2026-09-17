/**
 * 按轮截断会话 state —— 编辑重发/重新生成/回退/Fork 四个前端动作共享的
 * 纯函数核心（R2P-154a，对齐 Rust 0a2cc4e `session::truncate_state_turns`）。
 *
 * 「轮」= 一条 `role === "user"` 的消息 + 其后直到下一条 user 消息之前的
 * 全部消息。`keepTurns = N` 保留第 1..=N 轮，丢弃其余；`keepTurns = 0`
 * 清空 `context.messages`（编辑/重发首轮时使用）。序列头部（首条 user
 * 之前）的非 user 消息归「第 0 段」，任何 keepTurns 下都保留 —— 正常
 * 会话不会出现，纯防御。
 *
 * 操作在序列化文本层面进行（`JSON.parse` 成普通对象再改写），不经过
 * colts `AgentState` 往返 —— daemon 端点与宿主侧的 Fork 目录拷贝共用
 * 同一份逻辑，且不受 `AgentState` 字段演进的影响。同时删除
 * `context.todoList`（截断后任务清单与消息不再对应；旧存档本就无此键，
 * 前端按缺席降级）；**不动任何统计/计费字段** —— `context.totalTokens`
 * 累计账是计费语义，永不因 UI 操作清零。
 *
 * `context.compression`（含 anchor）对齐 Rust 的处理：**完全不触碰**
 * （Rust truncate 既不删整个 compression 键、也不钳制 anchor）。消费侧
 * 天然安全：message-assembler 以 `for (i = anchor; i < messages.length;
 * i++)` 循环取活区，越界 anchor 只会让本轮发给 LLM 的活区为空、摘要
 * 照发；compressor 的 `Math.max(existingAnchor, …)` 也不会因 anchor 越
 * 界而崩溃，下一次压缩自行重算边界。
 */

/** 截断产物：改写后的 state JSON 文本 + 实际保留的轮数（钳制后）。 */
export interface TruncatedState {
  json: string;
  keptTurns: number;
}

/** 截断结果：失败时调用方应报错，绝不覆写原文件。 */
export type TruncateResult = { ok: true; state: TruncatedState } | { ok: false; error: string };

/**
 * 判断消息是否开启一轮（user 消息）。非对象/缺 role 的畸形条目归入
 * 当前轮，不开启新轮。
 */
function startsTurn(msg: unknown): boolean {
  return typeof msg === 'object' && msg !== null && (msg as { role?: unknown }).role === 'user';
}

/** 统计 `context.messages` 里的总轮数（user 消息条数）。 */
function totalTurns(root: unknown): number {
  const context = (root as { context?: { messages?: unknown } }).context;
  const messages = context?.messages;
  if (!Array.isArray(messages)) return 0;
  return messages.filter(startsTurn).length;
}

/**
 * 按轮截断 state JSON 文本，见模块文档。`keepTurns` 超过总轮数时为幂等
 * no-op（消息不变，返回钳制后的 `keptTurns`，调用方可据此感知；
 * `todoList` 键仍会删除 —— 与 Rust 逐语义对齐）。非法 JSON 返回
 * `{ok: false}`，调用方绝不能覆写原文件。
 */
export function truncateStateTurns(raw: string, keepTurns: number): TruncateResult {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `invalid state JSON: ${e instanceof Error ? e.message : e}` };
  }
  const clamped = Math.max(0, Math.min(keepTurns, totalTurns(root)));
  const context = (root as { context?: Record<string, unknown> }).context;
  if (typeof context === 'object' && context !== null) {
    const messages = context.messages;
    if (Array.isArray(messages)) {
      // 第 0 段（turn === 0）恒 ≤ keepTurns，天然保留。
      let turn = 0;
      context.messages = messages.filter((m) => {
        if (startsTurn(m)) turn += 1;
        return turn <= clamped;
      });
    }
    // 任务清单快照与截断后的消息不再对应，直接删键（前端按缺席降级）。
    delete context.todoList;
  }
  return { ok: true, state: { json: JSON.stringify(root), keptTurns: clamped } };
}
