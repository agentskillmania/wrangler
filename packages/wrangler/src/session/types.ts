/** Unified session entry for session.jsonl */
export interface SessionEntry {
  /** Unique message ID (UUID v4, from colts Message.id) */
  id: string;
  /** Message role */
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  /** Text content */
  content: string;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  toolName?: string;
  toolArguments?: string;
  result?: string;
  exitCode?: number;
  errorMessage?: string;
}
