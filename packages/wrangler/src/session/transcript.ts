// packages/core/src/session/transcript.ts

import type { TranscriptEntry } from '../types.js';

/**
 * Serializes a TranscriptEntry to a JSONL line (single-line JSON + newline).
 */
export function formatTranscriptEntry(entry: TranscriptEntry): string {
  return JSON.stringify(entry) + '\n';
}
