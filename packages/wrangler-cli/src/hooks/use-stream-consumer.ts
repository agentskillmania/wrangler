import type { TimelineEntry } from '../types.js';

/**
 * Instance-level seq counter — P4 fix: no global mutable state.
 */
export class StreamConsumer {
  private seq = 0;
  private nextSeq(): number {
    return ++this.seq;
  }
  private idCounter = 0;
  private nextId(): string {
    return `entry-${++this.idCounter}`;
  }

  private bufferedAssistant: {
    id: string;
    seq: number;
    content: string;
    timestamp: number;
  } | null = null;

  // Track tool names from tool:start events for matching with tool:end
  private activeToolNames: Map<string, string> = new Map();

  /**
   * Reset internal state for a new run.
   * Clears buffered content and tool tracking, but preserves seq/id counters
   * to avoid key collisions across runs.
   */
  reset(): void {
    this.bufferedAssistant = null;
    this.activeToolNames.clear();
  }

  /**
   * Consume a single stream event, return any new timeline entries.
   *
   * Handles both TUI-level events (text-delta, tool-start, etc.) and
   * colts RunStreamEvent types (token, tool:start, tool:end, complete, etc.).
   */
  consume(event: Record<string, unknown>): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    const type = event.type as string;
    const timestamp = (event.timestamp as number) ?? Date.now();

    // Flush any buffered assistant before processing non-text events
    if (type !== 'text-delta' && type !== 'token' && this.bufferedAssistant) {
      entries.push({
        type: 'assistant',
        ...this.bufferedAssistant,
      });
      this.bufferedAssistant = null;
    }

    switch (type) {
      case 'user-message': {
        entries.push({
          type: 'user',
          id: this.nextId(),
          seq: this.nextSeq(),
          content: event.content as string,
          timestamp,
        });
        break;
      }
      case 'text-delta':
      case 'token': {
        // 'token' is the colts stream event, 'text-delta' is the TUI-level event
        const text = (event.text ?? event.token) as string;
        if (!this.bufferedAssistant) {
          this.bufferedAssistant = {
            id: this.nextId(),
            seq: this.nextSeq(),
            content: '',
            timestamp,
          };
        }
        this.bufferedAssistant.content += text;
        // Return buffered assistant with isStreaming for real-time display
        entries.push({
          type: 'assistant',
          ...this.bufferedAssistant,
          isStreaming: true,
        });
        break;
      }
      case 'tool-start': {
        entries.push({
          type: 'tool',
          id: this.nextId(),
          seq: this.nextSeq(),
          tool: event.toolName as string,
          summary: '',
          isRunning: true,
          timestamp,
        });
        break;
      }
      case 'tool:start': {
        // Colts stream event: tool:start has action.tool as toolName
        const action = event.action as Record<string, unknown> | undefined;
        const toolName = (action?.tool as string) ?? 'unknown';
        const callId = (action?.id as string) ?? '';
        if (callId) {
          this.activeToolNames.set(callId, toolName);
        }
        entries.push({
          type: 'tool',
          id: this.nextId(),
          seq: this.nextSeq(),
          tool: toolName,
          summary: '',
          isRunning: true,
          timestamp,
        });
        break;
      }
      case 'tool-end': {
        const resultStr =
          typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
        entries.push({
          type: 'tool',
          id: this.nextId(),
          seq: this.nextSeq(),
          tool: event.toolName as string,
          summary: resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr,
          isRunning: false,
          timestamp,
        });
        break;
      }
      case 'tool:end': {
        // Colts stream event: tool:end has result and optional callId
        const callId = event.callId as string | undefined;
        const toolName = (callId && this.activeToolNames.get(callId)) ?? 'unknown';
        if (callId) {
          this.activeToolNames.delete(callId);
        }
        const resultStr =
          typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
        entries.push({
          type: 'tool',
          id: this.nextId(),
          seq: this.nextSeq(),
          tool: toolName,
          summary: resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr,
          isRunning: false,
          timestamp,
        });
        break;
      }
      case 'error': {
        const err = event.error as Error;
        entries.push({
          type: 'error',
          id: this.nextId(),
          seq: this.nextSeq(),
          message: err?.message ?? String(event.error),
          timestamp,
        });
        break;
      }
      case 'run-complete':
      case 'complete': {
        // 'complete' is the colts stream event, 'run-complete' is TUI-level
        entries.push({
          type: 'run-complete',
          id: this.nextId(),
          seq: this.nextSeq(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result: event.result as any,
          timestamp,
        });
        break;
      }
    }

    return entries;
  }

  /**
   * Flush any buffered assistant entry (finalize streaming).
   */
  flush(): TimelineEntry[] {
    if (!this.bufferedAssistant) return [];
    const entry: TimelineEntry = {
      type: 'assistant',
      ...this.bufferedAssistant,
      isStreaming: false,
    };
    this.bufferedAssistant = null;
    return [entry];
  }
}
