import type { AgentState } from '@agentskillmania/colts';
import { addUserMessage } from '@agentskillmania/colts';
import type { EnhancedRunner } from '@agentskillmania/wrangler';
import { useState, useRef, useCallback } from 'react';

import type { TimelineEntry, RunStatus } from '../types.js';
import { StreamConsumer } from './use-stream-consumer.js';

/**
 * Merge new entries into existing list.
 * Entries with the same id replace existing ones (streaming updates + flush).
 */
function mergeStreamingEntries(prev: TimelineEntry[], incoming: TimelineEntry[]): TimelineEntry[] {
  const updated = [...prev];
  for (const entry of incoming) {
    const idx = updated.findIndex((e) => e.id === entry.id);
    if (idx !== -1) {
      updated[idx] = entry;
    } else {
      updated.push(entry);
    }
  }
  return updated;
}

export interface UseAgentReturn {
  entries: TimelineEntry[];
  state: AgentState | null;
  status: RunStatus;
  sendMessage: (input: string) => Promise<void>;
  abort: () => void;
  clearEntries: () => void;
  addSystemEntry: (content: string) => void;
}

/**
 * Hook for single-agent mode.
 *
 * Uses refs for runner/state to avoid stale closure issues
 * and dependency array rebuilds.
 */
export function useAgent(
  runner: EnhancedRunner | null,
  initialState: AgentState | null
): UseAgentReturn {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [status, setStatus] = useState<RunStatus>('ready');
  const stateRef = useRef<AgentState | null>(initialState);
  const runnerRef = useRef(runner);
  const consumerRef = useRef(new StreamConsumer());
  const abortRef = useRef<AbortController | null>(null);
  const isRunningRef = useRef(false);

  // Sync refs when props change
  runnerRef.current = runner;
  if (initialState && !stateRef.current) {
    stateRef.current = initialState;
  }

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('ready');
  }, []);

  const sendMessage = useCallback(
    async (input: string) => {
      if (isRunningRef.current) return;
      isRunningRef.current = true;

      const runner = runnerRef.current;
      let state = stateRef.current;
      if (!runner || !state) {
        isRunningRef.current = false;
        return;
      }

      // Add user message to entries
      const userEntry: TimelineEntry = {
        type: 'user',
        id: `user-${Date.now()}`,
        seq: entries.length + 1,
        content: input,
        timestamp: Date.now(),
      };
      setEntries((prev) => [...prev, userEntry]);

      // Update state with user message
      state = addUserMessage(state, input);
      stateRef.current = state;

      setStatus('running');

      const abortController = new AbortController();
      abortRef.current = abortController;
      const consumer = consumerRef.current;
      consumer.reset();

      try {
        const stream = runner.runStream(state, { signal: abortController.signal });
        for await (const event of stream) {
          const newEntries = consumer.consume(event as Record<string, unknown>);
          if (newEntries.length > 0) {
            setEntries((prev) => mergeStreamingEntries(prev, newEntries));
          }
        }

        // Flush remaining buffered content
        const flushed = consumer.flush();
        if (flushed.length > 0) {
          setEntries((prev) => mergeStreamingEntries(prev, flushed));
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          setEntries((prev) => [
            ...prev,
            {
              type: 'system',
              id: `sys-${Date.now()}`,
              seq: prev.length + 1,
              content: 'Run interrupted',
              timestamp: Date.now(),
            },
          ]);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setEntries((prev) => [
            ...prev,
            {
              type: 'error',
              id: `err-${Date.now()}`,
              seq: prev.length + 1,
              message,
              timestamp: Date.now(),
            },
          ]);
        }
      } finally {
        isRunningRef.current = false;
        setStatus('ready');
        abortRef.current = null;
      }
    },
    [entries.length]
  );

  const clearEntries = useCallback(() => setEntries([]), []);

  const addSystemEntry = useCallback((content: string) => {
    setEntries((prev) => [
      ...prev,
      {
        type: 'system',
        id: `sys-${Date.now()}`,
        seq: prev.length + 1,
        content,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  return {
    entries,
    state: stateRef.current,
    status,
    sendMessage,
    abort,
    clearEntries,
    addSystemEntry,
  };
}
