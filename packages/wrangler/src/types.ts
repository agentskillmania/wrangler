// packages/core/src/types.ts

export type { SessionEntry } from './session/types.js';

/**
 * Session metadata — persisted in meta.yaml
 */
/** Title origin — how the session title was set. */
export type TitleSource = 'auto' | 'generated' | 'manual';

export interface SessionMeta {
  /** Session ID (= state.id) */
  id: string;
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
  /** Model used for this session */
  model: string;
  /** Agent name for this session */
  agentName: string;
}
