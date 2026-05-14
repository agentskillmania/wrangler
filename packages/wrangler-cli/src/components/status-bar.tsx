import React from 'react';
import { Text, Box } from 'ink';
import type { RunStatus } from '../types.js';

interface StatusBarProps {
  agentName: string;
  sessionName?: string;
  model: string;
  status: RunStatus;
  isCrewMode: boolean;
  hint?: string;
}

const STATUS_COLORS: Record<RunStatus, string> = {
  ready: 'green',
  running: 'yellow',
  waiting: 'yellow',
};

export function StatusBar({ agentName, sessionName, model, status, isCrewMode, hint }: StatusBarProps) {
  const statusIndicator = status === 'running' ? '●' : status === 'waiting' ? '◐' : '●';
  const statusColor = STATUS_COLORS[status];

  const namePart = isCrewMode && sessionName
    ? `${agentName} [${sessionName}]`
    : agentName;

  const rightPart = hint ?? 'Ctrl+C exit';

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="blue">wrangler v0.1</Text>
      <Text color="gray"> │ </Text>
      <Text bold>{namePart}</Text>
      <Text color="gray"> │ </Text>
      <Text color="cyan">{model}</Text>
      <Text color="gray"> │ </Text>
      <Text color={statusColor}>{statusIndicator} {status}</Text>
      <Text color="gray"> │ </Text>
      <Text color="gray">{rightPart}</Text>
    </Box>
  );
}
