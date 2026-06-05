// packages/core/src/types.ts

export type { SessionEntry } from './session/types.js';

/**
 * Session metadata — persisted in meta.yaml
 */
export interface SessionMeta {
  /** Session ID (= state.id) */
  id: string;
  /** Human-readable session title. Missing → frontend shows "Untitled". */
  title?: string;
  /** Workspace path this session belongs to */
  workspacePath: string;
  /** Creation time (ISO string) */
  createdAt: string;
  /** Last update time (ISO string) */
  updatedAt: string;
  /** Model used for this session */
  model: string;
  /** Agent name for this session */
  agentName: string;
}

/** Session status tracked in daemon memory. */
export type SessionStatus = 'idle' | 'running' | 'error';

/** Session overview — dashboard summary metrics for the Overview card. */
export interface SessionOverview {
  /** Human-readable session title. Missing → frontend shows "Untitled". */
  title?: string;
  /** Agent name from AGENT.md config. */
  agentName: string;
  /** Resolved model (configured default, not per-request override). */
  model: string;
  /** Cumulative execution steps. */
  stepCount: number;
  /** Total messages in conversation history. */
  messageCount: number;
  /** Cumulative input tokens. */
  tokensIn?: number;
  /** Cumulative output tokens. */
  tokensOut?: number;
  /** Cumulative total tokens. */
  tokensTotal?: number;
  /** Estimated next-request context tokens (tiktoken). */
  estimatedContextSize?: number;
  /** Context window limit for the model. From llm-client ModelMeta. */
  contextWindow?: number;
  /** Runtime status from daemon memory. */
  status: SessionStatus;
  /** ISO timestamp when session was created. */
  createdAt: string;
  /** ISO timestamp when session was last updated. */
  updatedAt: string;
}

/** Session info — detailed key-value data for the Session Info card. */
export interface SessionInfo {
  /** Session ID (timestamp-random format from colts). */
  sessionId: string;
  /** Agent name. */
  agentName: string;
  /** Agent definition file path. */
  agentConfigPath?: string;
  /** Resolved model. */
  model: string;
  /** Cumulative input tokens (exact number). */
  tokensIn?: number;
  /** Cumulative output tokens (exact number). */
  tokensOut?: number;
  /** Cumulative total tokens (exact number). */
  tokensTotal?: number;
  /** Workspace root path. */
  workspacePath: string;
  /** Session data directory path. */
  sessionPath?: string;
  /** Resolved skill directories. */
  skillDirs: string[];
  /** MCP configuration file paths. */
  mcpConfigPaths: string[];
}

/** Session diagnostics — aggregated session data in agent-diagnostics SSE payload. */
export interface SessionDiagnostics {
  overview: SessionOverview;
  info: SessionInfo;
}
