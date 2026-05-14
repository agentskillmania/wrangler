import React from 'react';
import { Box, Text, useInput } from 'ink';

interface ConfirmDialogProps {
  toolName: string;
  summary: string;
  onResult: (result: 'yes' | 'no' | 'always') => void;
}

export function ConfirmDialog({ toolName, summary, onResult }: ConfirmDialogProps) {
  useInput((input) => {
    const key = input.toLowerCase();
    if (key === 'y') onResult('yes');
    else if (key === 'n') onResult('no');
    else if (key === 'a') onResult('always');
  });

  return (
    <Box borderStyle="round" borderColor="yellow" paddingLeft={1} flexDirection="column">
      <Text color="yellow">⚠ Agent wants to call tool: <Text bold>{toolName}</Text></Text>
      <Text color="gray">{summary}</Text>
      <Text>
        Allow? <Text color="green">[y]es</Text> / <Text color="red">[n]o</Text> / <Text color="cyan">[a]lways for this tool</Text>
      </Text>
    </Box>
  );
}
