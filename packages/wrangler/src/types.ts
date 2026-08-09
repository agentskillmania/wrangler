// packages/core/src/types.ts

// SessionEntry type removed — session.jsonl deleted

/**
 * Session metadata — persisted in meta.yaml
 */
/** Title origin — how the session title was set. */
export type TitleSource = 'auto' | 'generated' | 'manual';

/**
 * Snapshot of runner configuration at session creation time.
 * Used to reconstruct the exact runner environment on resume.
 */
export interface RunnerConfigSnapshot {
  /** Model used for this session */
  model: string;
  /** Skill directories */
  skillDirs?: string[];
  /** MCP configuration file paths */
  mcpConfigPaths?: string[];
  /** Builtin tool toggles */
  builtinTools?: Record<string, boolean>;
  /** Sandbox enabled */
  sandbox?: boolean;
  /** Session support enabled */
  enableSession?: boolean;
  /** Todolist support enabled */
  enableTodolist?: boolean;
  /** Spec-plan tools enabled */
  enableSpecPlan?: boolean;
  /** Commands enabled */
  enableCommands?: boolean;
  /** A2UI support */
  a2ui?: { enabled: boolean };
  /** Crew identifier — set when this session runs a crew (used to reload crew config on resume) */
  crewId?: string;
}

/** Source of session creation — how the runner was initialized */
export type SessionSource =
  | { type: 'agent'; configPath: string }
  | { type: 'bare' }
  | { type: 'code' };

export interface SessionMeta {
  /** Session ID (= state.id). Undefined in dir-bound mode (no id concept). */
  id?: string;
  /** Human-readable session title. Missing → frontend shows "Untitled". */
  title?: string;
  /** How the title was set. Used to decide whether Phase 2 should upgrade it. */
  titleSource?: TitleSource;
  /** Workspace path this session belongs to */
  workspacePath: string;
  /** Creation time (ISO string) */
  createdAt: string;
  /** Last update time (ISO string) */
  updatedAt: string;
  /** Agent name for this session */
  agentName: string;
  /** Runner configuration snapshot */
  runnerConfig: RunnerConfigSnapshot;
  /** Source of session creation */
  source?: SessionSource;
  /** Application-level metadata extension */
  metadata?: Record<string, unknown>;
}
