import React from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import type { RunStatus, ParsedCommand } from '../types.js';
import { parseCommand } from '../types.js';

interface InputBarProps {
  status: RunStatus;
  isReadOnly?: boolean;
  onSubmit: (command: ParsedCommand) => void;
}

export function InputBar({ status, isReadOnly, onSubmit }: InputBarProps) {
  if (isReadOnly) {
    return (
      <Box paddingX={1}>
        <Text color="gray">(read-only — session is completed)</Text>
      </Box>
    );
  }

  if (status === 'running') {
    return (
      <Box paddingX={1}>
        <Text color="yellow">{'❯ '}</Text>
        <Text color="gray">Agent is running...</Text>
      </Box>
    );
  }

  const handleSubmit = (input: string) => {
    if (!input.trim()) return;
    onSubmit(parseCommand(input));
  };

  // Key forces a fresh TextInput when status changes back to ready,
  // so the previous submission is cleared.
  const key = status;

  return (
    <Box paddingX={1}>
      <Text color="yellow">{'❯ '}</Text>
      <TextInput
        key={key}
        defaultValue=""
        onSubmit={handleSubmit}
        placeholder="Type a message... (/help for commands)"
      />
    </Box>
  );
}
