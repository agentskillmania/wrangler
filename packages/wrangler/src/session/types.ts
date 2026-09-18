// SessionEntry type removed — session.jsonl persistence was deleted.
// state.json (full AgentState snapshot) is the sole conversation persistence mechanism.

/**
 * 异步子任务的待投递结果（邮箱条目，`deliveries.json` sidecar）。
 * 对齐 Rust session/types.rs 的 PendingDelivery——camelCase 序列化，
 * 写穿语义（push/drain 即落盘）。
 *
 * 子代理在后台完成（或超时/出错）后，结果作为一条投递入箱；主 agent
 * 空闲时消费，忙时排队。崩溃语义：进程重启丢任务不丢投递——sidecar
 * 在盘，下次物化时消费。
 */
export interface PendingDelivery {
  /** 子任务 id（delegate 侧 `{agent}-{utc毫秒}-{序号}`）。 */
  subtaskId: string;
  /** 执行该任务的 worker 名。 */
  agent: string;
  /** 结果正文（answer / 错误描述 / timeout 说明）。 */
  content: string;
  /** success / error / timeout / abort / max_steps。 */
  status: string;
  /** 完成时刻（unix 毫秒）。 */
  completedAt: number;
}
