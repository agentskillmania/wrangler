/** Unified conversation message for user-chat.jsonl and group-chat.jsonl */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  content: string;
  timestamp: number;
  toolName?: string;
  toolArguments?: string;
  exitCode?: number;
  errorMessage?: string;
}
