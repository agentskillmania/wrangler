import React, { useCallback } from 'react';
import { Box, useInput, useApp } from 'ink';
import { TimelinePanel } from './timeline-panel.js';
import { InputBar } from './input-bar.js';
import { StatusBar } from './status-bar.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { AskDialog } from './ask-dialog.js';
import type { ParsedCommand } from '../types.js';
import type { UseAgentReturn } from '../hooks/use-agent.js';

export type DialogState =
  | { type: 'none' }
  | { type: 'confirm'; toolName: string; summary: string }
  | { type: 'ask'; question: string };

interface MainTUIProps {
  agentHook: UseAgentReturn;
  agentName: string;
  model: string;
  isCrewMode: boolean;
  currentSession: string;
  dialog: DialogState;
  onConfirmResult: (result: 'yes' | 'no' | 'always') => void;
  onAskAnswer: (answer: string) => void;
}

/**
 * Top-level TUI layout: TimelinePanel + InputBar/Dialog + StatusBar.
 *
 * Layout order (top to bottom):
 *   1. TimelinePanel (flexible, fills remaining space)
 *   2. InputBar / ConfirmDialog / AskDialog (conditional)
 *   3. StatusBar (fixed at bottom)
 */
export function MainTUI({
  agentHook,
  agentName,
  model,
  isCrewMode,
  currentSession,
  dialog,
  onConfirmResult,
  onAskAnswer,
}: MainTUIProps) {
  const { entries, status, sendMessage, abort } = agentHook;
  const { exit } = useApp();

  // Global Ctrl+C handler: abort a running agent or exit the app
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'running') {
        abort();
      } else {
        exit();
      }
    }
  });

  const handleCommand = useCallback(
    (cmd: ParsedCommand) => {
      switch (cmd.type) {
        case 'message':
          sendMessage(cmd.content);
          break;
        case 'clear':
          agentHook.clearEntries();
          break;
        case 'help':
          agentHook.addSystemEntry(
            'Commands: /clear — clear chat history, /help — show this message, /sessions — list sessions, /session <name> — switch session'
          );
          break;
        case 'sessions':
        case 'switch-session':
          agentHook.addSystemEntry('Session management is not yet implemented.');
          break;
      }
    },
    [sendMessage, agentHook],
  );

  const isReadOnly =
    isCrewMode &&
    currentSession !== 'primary' &&
    entries.some((e) => e.type === 'run-complete');

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1}>
        <TimelinePanel entries={entries} />
      </Box>
      {dialog.type === 'confirm' ? (
        <ConfirmDialog
          toolName={dialog.toolName}
          summary={dialog.summary}
          onResult={onConfirmResult}
        />
      ) : dialog.type === 'ask' ? (
        <AskDialog question={dialog.question} onAnswer={onAskAnswer} />
      ) : (
        <InputBar status={status} isReadOnly={isReadOnly} onSubmit={handleCommand} />
      )}
      <StatusBar
        agentName={agentName}
        sessionName={isCrewMode ? currentSession : undefined}
        model={model}
        status={dialog.type !== 'none' ? 'waiting' : status}
        isCrewMode={isCrewMode}
      />
    </Box>
  );
}
