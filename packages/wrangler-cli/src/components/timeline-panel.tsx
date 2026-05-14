import React from 'react';
import { Box } from 'ink';
import type { TimelineEntry as TEntry } from '../types.js';
import { TimelineEntry } from './timeline-entry.js';

interface TimelinePanelProps {
  entries: TEntry[];
}

/**
 * Scrollable timeline that renders all conversation entries.
 * Grows to fill remaining vertical space in the layout.
 */
export function TimelinePanel({ entries }: TimelinePanelProps) {
  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {entries.map((entry) => (
        <TimelineEntry key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}
