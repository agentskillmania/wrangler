import React from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';

interface AskDialogProps {
  question: string;
  onAnswer: (answer: string) => void;
}

export function AskDialog({ question, onAnswer }: AskDialogProps) {
  const handleSubmit = (answer: string) => {
    if (answer.trim()) onAnswer(answer.trim());
  };

  return (
    <Box borderStyle="round" borderColor="cyan" paddingLeft={1} flexDirection="column">
      <Text color="cyan">❓ Agent asks:</Text>
      <Text>  {question}</Text>
      <Box marginTop={1}>
        <Text color="yellow">{'❯ '}</Text>
        <TextInput defaultValue="" onSubmit={handleSubmit} placeholder="Type your answer..." />
      </Box>
    </Box>
  );
}
