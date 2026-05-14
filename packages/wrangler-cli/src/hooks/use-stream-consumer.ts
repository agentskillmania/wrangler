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

  /**
   * Consume a single stream event, return any new timeline entries.
   */
  consume(event: Record<string, unknown>): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    const type = event.type as string;
    const timestamp = (event.timestamp as number) ?? Date.now();

    // Flush any buffered assistant before processing non-text events
    if (type !== 'text-delta' && this.bufferedAssistant) {
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
      case 'text-delta': {
        const text = event.text as string;
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
      case 'run-complete': {
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
