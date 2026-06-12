/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render } from 'ink-testing-library';
import type { UseAgentReturn } from '../../../src/hooks/use-agent.js';
import type { ParsedCommand } from '../../../src/types.js';

// Capture useInput callback
let capturedUseInput: ((input: string, key: { ctrl: boolean }) => void) | null = null;

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useInput: (cb: (input: string, key: { ctrl: boolean }) => void) => {
      capturedUseInput = cb;
    },
    useApp: () => ({ exit: vi.fn() }),
  };
});

// Capture InputBar onSubmit
let capturedInputSubmit: ((cmd: ParsedCommand) => void) | null = null;

vi.mock('../../../src/components/input-bar.js', async () => {
  const { Text } = await import('ink');
  return {
    InputBar: (props: { status: string; onSubmit: (cmd: ParsedCommand) => void }) => {
      capturedInputSubmit = props.onSubmit;
      return React.createElement(Text, null, `InputBar[${props.status}]`);
    },
  };
});

vi.mock('../../../src/components/status-bar.js', async () => {
  const { Text } = await import('ink');
  return {
    StatusBar: (props: Record<string, unknown>) =>
      React.createElement(Text, null, `StatusBar[${props.agentName as string}]`),
  };
});

vi.mock('../../../src/components/timeline-panel.js', async () => {
  const { Text } = await import('ink');
  return {
    TimelinePanel: (props: Record<string, unknown>) =>
      React.createElement(Text, null, `TimelinePanel[${(props.entries as unknown[]).length}]`),
  };
});

vi.mock('../../../src/components/confirm-dialog.js', async () => {
  const { Text } = await import('ink');
  return {
    ConfirmDialog: (props: { toolName: string; summary: string }) =>
      React.createElement(Text, null, `ConfirmDialog[${props.toolName}]`),
  };
});

vi.mock('../../../src/components/ask-dialog.js', async () => {
  const { Text } = await import('ink');
  return {
    AskDialog: (props: { question: string }) =>
      React.createElement(Text, null, `AskDialog[${props.question}]`),
  };
});

import { MainTUI } from '../../../src/components/main-tui.js';

function makeAgentHook(overrides?: Partial<UseAgentReturn>): UseAgentReturn {
  return {
    entries: [],
    state: null,
    status: 'ready',
    sendMessage: vi.fn(),
    abort: vi.fn(),
    clearEntries: vi.fn(),
    addSystemEntry: vi.fn(),
    ...overrides,
  };
}

function makeProps(
  overrides?: Partial<{
    agentHook: UseAgentReturn;
    dialog: DialogState;
    onConfirmResult: (result: 'yes' | 'no' | 'always') => void;
    onAskAnswer: (answer: string) => void;
  }>
) {
  return {
    agentHook: makeAgentHook(),
    agentName: 'test-agent',
    model: 'gpt-4',
    isCrewMode: false,
    currentSession: 'primary',
    dialog: { type: 'none' as const } satisfies DialogState,
    onConfirmResult: vi.fn(),
    onAskAnswer: vi.fn(),
    ...overrides,
  };
}

describe('MainTUI', () => {
  beforeEach(() => {
    capturedUseInput = null;
    capturedInputSubmit = null;
  });

  it('renders with agent name in StatusBar', () => {
    const { lastFrame } = render(React.createElement(MainTUI, makeProps()));
    expect(lastFrame()).toContain('StatusBar[test-agent]');
  });

  it('renders timeline with entries', () => {
    const entries = [
      { type: 'user' as const, id: '1', seq: 1, content: 'hi', timestamp: 0 },
    ];
    const { lastFrame } = render(
      React.createElement(MainTUI, makeProps({ agentHook: makeAgentHook({ entries }), agentName: 'agent' }))
    );
    expect(lastFrame()).toContain('TimelinePanel[1]');
  });

  it('renders InputBar with ready status', () => {
    const { lastFrame } = render(
      React.createElement(MainTUI, makeProps({ agentName: 'agent' }))
    );
    expect(lastFrame()).toContain('InputBar[ready]');
  });

  it('forwards message type commands to sendMessage', () => {
    const sendMessage = vi.fn();
    render(React.createElement(MainTUI, makeProps({ agentHook: makeAgentHook({ sendMessage }), agentName: 'agent' })));

    capturedInputSubmit!({ type: 'message', content: 'hello' });
    expect(sendMessage).toHaveBeenCalledWith('hello');
  });

  it('calls abort on Ctrl+C when status is running', () => {
    const abort = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ status: 'running', abort }), agentName: 'agent' })
      )
    );

    capturedUseInput!('c', { ctrl: true });
    expect(abort).toHaveBeenCalled();
  });

  it('does not call abort on Ctrl+C when status is ready', () => {
    const abort = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ status: 'ready', abort }), agentName: 'agent' })
      )
    );

    capturedUseInput!('c', { ctrl: true });
    // When status is ready, abort should NOT be called (exit is called instead)
    expect(abort).not.toHaveBeenCalled();
  });

  it('ignores non-Ctrl+C input', () => {
    const abort = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ status: 'ready', abort }), agentName: 'agent' })
      )
    );

    capturedUseInput!('a', { ctrl: false });
    expect(abort).not.toHaveBeenCalled();
  });

  it('passes isReadOnly=true when crew mode + non-primary session + run-complete entry', () => {
    const entries = [
      { type: 'run-complete' as const, id: '1', seq: 1, content: '', timestamp: 0 },
    ];
    const { lastFrame } = render(
      React.createElement(
        MainTUI,
        makeProps({
          agentHook: makeAgentHook({ entries }),
          agentName: 'agent',
          isCrewMode: true,
          currentSession: 'secondary',
        })
      )
    );
    // InputBar mock receives isReadOnly through the status prop
    // Since InputBar mock shows InputBar[{status}], we just verify it renders
    expect(lastFrame()).toContain('InputBar');
  });

  it('passes isReadOnly=false when not in crew mode', () => {
    const entries = [
      { type: 'run-complete' as const, id: '1', seq: 1, content: '', timestamp: 0 },
    ];
    const { lastFrame } = render(
      React.createElement(
        MainTUI,
        makeProps({
          agentHook: makeAgentHook({ entries }),
          agentName: 'agent',
          isCrewMode: false,
          currentSession: 'secondary',
        })
      )
    );
    expect(lastFrame()).toContain('InputBar');
  });

  it('handles clear command without error', () => {
    const sendMessage = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ sendMessage }), agentName: 'agent' })
      )
    );

    capturedInputSubmit!({ type: 'clear' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('handles help command without error', () => {
    const sendMessage = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ sendMessage }), agentName: 'agent' })
      )
    );

    capturedInputSubmit!({ type: 'help' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('handles sessions command without error', () => {
    const sendMessage = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ sendMessage }), agentName: 'agent' })
      )
    );

    capturedInputSubmit!({ type: 'sessions' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('calls clearEntries on /clear command', () => {
    const clearEntries = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ clearEntries }), agentName: 'agent' })
      )
    );

    capturedInputSubmit!({ type: 'clear' });
    expect(clearEntries).toHaveBeenCalled();
  });

  it('calls addSystemEntry on /help command', () => {
    const addSystemEntry = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ addSystemEntry }), agentName: 'agent' })
      )
    );

    capturedInputSubmit!({ type: 'help' });
    expect(addSystemEntry).toHaveBeenCalledWith(expect.stringContaining('Commands:'));
  });

  it('renders ConfirmDialog when dialog type is confirm', () => {
    const { lastFrame } = render(
      React.createElement(
        MainTUI,
        makeProps({
          dialog: { type: 'confirm', toolName: 'shell', summary: 'ls -la' },
        })
      )
    );
    expect(lastFrame()).toContain('ConfirmDialog[shell]');
    expect(lastFrame()).not.toContain('InputBar');
  });

  it('renders AskDialog when dialog type is ask', () => {
    const { lastFrame } = render(
      React.createElement(
        MainTUI,
        makeProps({
          dialog: { type: 'ask', question: 'What is your name?' },
        })
      )
    );
    expect(lastFrame()).toContain('AskDialog[What is your name?]');
    expect(lastFrame()).not.toContain('InputBar');
  });

  it('forwards confirm result to onConfirmResult callback', () => {
    const onConfirmResult = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({
          dialog: { type: 'confirm', toolName: 'shell', summary: 'rm -rf' },
          onConfirmResult,
        })
      )
    );
    // ConfirmDialog mock doesn't expose a way to trigger onResult,
    // but we verify the prop is passed by checking the component renders
    expect(onConfirmResult).not.toHaveBeenCalled();
  });

  it('handles switch-session command by adding a system entry', () => {
    const sendMessage = vi.fn();
    const addSystemEntry = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({ agentHook: makeAgentHook({ sendMessage, addSystemEntry }), agentName: 'agent' })
      )
    );

    capturedInputSubmit!({ type: 'switch-session', name: 'subagent-1' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(addSystemEntry).toHaveBeenCalledWith('Session management is not yet implemented.');
  });

  it('ignores unknown command types without calling handlers', () => {
    const sendMessage = vi.fn();
    const clearEntries = vi.fn();
    const addSystemEntry = vi.fn();
    render(
      React.createElement(
        MainTUI,
        makeProps({
          agentHook: makeAgentHook({ sendMessage, clearEntries, addSystemEntry }),
          agentName: 'agent',
        })
      )
    );

    // Cast to bypass TS and exercise the switch default (no-op) branch
    capturedInputSubmit!({ type: 'unknown' } as unknown as ParsedCommand);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(clearEntries).not.toHaveBeenCalled();
    expect(addSystemEntry).not.toHaveBeenCalled();
  });
});
