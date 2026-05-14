import React from 'react';
import { Text, Box } from 'ink';
import type { TimelineEntry as TEntry } from '../types.js';

interface TimelineEntryProps {
  entry: TEntry;
}

export function TimelineEntry({ entry }: TimelineEntryProps) {
  switch (entry.type) {
    case 'user':
      return (
        <Box>
          <Text color="teal" bold>{'❯ '}</Text>
          <Text bold>{entry.content}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box>
          <Text>{entry.content}</Text>
          {entry.isStreaming && <Text color="gray">▌</Text>}
        </Box>
      );

    case 'tool':
      return (
        <Box>
          <Text color="gray">
            {'  ── tool: '}
            <Text color="gray" bold>{entry.tool}</Text>
            {entry.summary ? ` ── ${entry.summary.slice(0, 80)} ──` : ' ──'}
            {entry.isRunning ? ' (running)' : ''}
          </Text>
        </Box>
      );

    case 'error':
      return (
        <Box>
          <Text color="red">✗ {entry.message}</Text>
        </Box>
      );

    case 'subagent-card': {
      const borderColor = entry.status === 'running' ? 'teal' : 'green';
      const icon = entry.status === 'running' ? '▎' : '✓';
      const label = entry.status === 'running' ? 'Running...' : 'Completed';
      const color = entry.status === 'running' ? 'teal' : 'green';
      return (
        <Box borderStyle="round" borderColor={borderColor} paddingLeft={1} flexDirection="column">
          <Text color={color}>{icon} [{entry.agentName}] {label}</Text>
          {entry.summary && <Text color="gray">  {entry.summary}</Text>}
          {entry.status === 'completed' && (
            <Text color="gray">  → /session {entry.agentName} to view</Text>
          )}
        </Box>
      );
    }

    case 'bare-notice':
      return (
        <Box borderStyle="round" borderColor="yellow" paddingLeft={1} flexDirection="column">
          <Text color="yellow">⚠ No agent or crew configuration found in {entry.path}</Text>
          <Text>Using a default assistant with no special instructions.</Text>
          <Text color="gray">Tip: Create an AGENT.md file to customize this agent.</Text>
        </Box>
      );

    case 'system':
      return (
        <Box>
          <Text color="gray">ℹ {entry.content}</Text>
        </Box>
      );

    case 'run-complete':
      return null;

    default:
      return null;
  }
}
