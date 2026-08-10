/**
 * Session diagnostics types — daemon-level aggregation for the agent-diagnostics SSE payload.
 *
 * These types represent how the daemon presents session data to consumers (cockpit UI).
 * They combine data from multiple sources: SessionStore, SessionManager, AgentState, RunnerConfig.
 * They do NOT belong in wrangler core because wrangler core has no concept of runtime session status
 * or cross-source aggregation.
 */

/** Runtime session status tracked in daemon memory by SessionManager. */
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
  /** Resolved model (per-request override if available, else session default). */
  model: string;
  /** Context window (tokens) of the model. */
  contextWindow?: number;
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

// ---- Runner diagnostics ----

/** Runner feature flags — boolean switches from EnhancedRunner config. */
export interface RunnerFeatureFlags {
  sandbox: boolean;
  thinkingEnabled: boolean;
  enablePromptThinking: boolean;
  a2uiEnabled: boolean;
  compressorEnabled: boolean;
  enableSession: boolean;
  enableTodolist: boolean;
  enableCommands: boolean;
}

/** Tool info from runner diagnostics. */
export interface RunnerToolInfo {
  name: string;
  description: string;
  type: string;
  enabled: boolean;
}

/** Skill info from runner diagnostics. */
export interface RunnerSkillInfo {
  name: string;
  description: string;
  source: string;
}

/** Runner diagnostics — structured runner capability data for the cockpit UI. */
export interface RunnerDiagnostics {
  features: RunnerFeatureFlags;
  tools: RunnerToolInfo[];
  skills: RunnerSkillInfo[];
}
