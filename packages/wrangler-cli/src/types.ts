import type { RunResult } from '@agentskillmania/colts';

export type TimelineEntry =
  | { type: 'user'; id: string; seq: number; content: string; timestamp: number }
  | {
      type: 'assistant';
      id: string;
      seq: number;
      content: string;
      timestamp: number;
      isStreaming?: boolean;
    }
  | {
      type: 'tool';
      id: string;
      seq: number;
      tool: string;
      summary: string;
      isRunning?: boolean;
      duration?: number;
      timestamp: number;
    }
  | { type: 'error'; id: string; seq: number; message: string; timestamp: number }
  | { type: 'run-complete'; id: string; seq: number; result: RunResult; timestamp: number }
  | {
      type: 'subagent-card';
      id: string;
      seq: number;
      agentName: string;
      status: 'running' | 'completed';
      summary?: string;
      timestamp: number;
    }
  | { type: 'bare-notice'; id: string; seq: number; path: string; timestamp: number }
  | { type: 'system'; id: string; seq: number; content: string; timestamp: number };

export type RunStatus = 'ready' | 'running' | 'waiting';

export type DetectedMode =
  | { mode: 'agent'; agentDir: string }
  | { mode: 'crew'; crewDir: string }
  | { mode: 'bare'; dir: string };

export interface SessionInfo {
  name: string;
  status: 'running' | 'completed' | 'idle';
  isCurrent: boolean;
}

export type ParsedCommand =
  | { type: 'message'; content: string }
  | { type: 'sessions' }
  | { type: 'switch-session'; name: string }
  | { type: 'clear' }
  | { type: 'help' };

export function parseCommand(input: string): ParsedCommand {
  if (!input.startsWith('/')) return { type: 'message', content: input };
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case '/sessions':
      return { type: 'sessions' };
    case '/session':
      return { type: 'switch-session', name: parts[1] ?? '' };
    case '/clear':
      return { type: 'clear' };
    case '/help':
      return { type: 'help' };
    default:
      return { type: 'message', content: input };
  }
}
