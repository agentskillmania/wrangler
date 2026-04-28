// packages/core/src/types.ts

/**
 * Session 元数据 — 存储在 meta.yaml
 */
export interface SessionMeta {
  /** Session ID（= state.id） */
  id: string;
  /** 所属 workspace 路径 */
  workspacePath: string;
  /** 创建时间（ISO string） */
  createdAt: string;
  /** 更新时间（ISO string） */
  updatedAt: string;
  /** 使用的模型 */
  model: string;
  /** 消息计数 */
  messageCount: number;
}

/**
 * Transcript 条目类型
 */
export type TranscriptEntry =
  | { type: 'user'; content: string; timestamp: number }
  | { type: 'assistant'; content: string; timestamp: number }
  | { type: 'tool'; toolName: string; arguments: string; result: string; timestamp: number }
  | { type: 'error'; message: string; timestamp: number };
