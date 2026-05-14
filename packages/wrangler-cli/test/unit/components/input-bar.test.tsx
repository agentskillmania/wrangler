import React from 'react';
import { render } from 'ink-testing-library';
import { InputBar } from '../../../src/components/input-bar.js';
import type { ParsedCommand } from '../../../src/types.js';

// Mock TextInput to capture its onSubmit callback for programmatic invocation.
let textInputOnSubmit: ((input: string) => void) | null = null;

vi.mock('@inkjs/ui', () => ({
  TextInput: (props: { onSubmit: (input: string) => void; placeholder?: string }) => {
    textInputOnSubmit = props.onSubmit;
    return React.createElement('span', { 'data-testid': 'text-input' }, props.placeholder ?? '');
  },
}));

describe('InputBar', () => {
  beforeEach(() => {
    textInputOnSubmit = null;
  });

  it('shows read-only message when isReadOnly is true', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      React.createElement(InputBar, { status: 'ready', isReadOnly: true, onSubmit }),
    );
    expect(lastFrame()).toContain('read-only');
    expect(lastFrame()).toContain('session is completed');
  });

  it('shows "Agent is running..." when status is running', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      React.createElement(InputBar, { status: 'running', onSubmit }),
    );
    expect(lastFrame()).toContain('Agent is running...');
  });

  it('renders TextInput with placeholder when status is ready', () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(
      React.createElement(InputBar, { status: 'ready', onSubmit }),
    );
    expect(lastFrame()).toContain('Type a message...');
    expect(lastFrame()).toContain('/help for commands');
  });

  it('calls onSubmit with parsed command when text is submitted', () => {
    const onSubmit = vi.fn();
    render(React.createElement(InputBar, { status: 'ready', onSubmit }));

    // The mock captures the TextInput's onSubmit callback
    expect(textInputOnSubmit).not.toBeNull();

    // Simulate a user submitting text through TextInput
    textInputOnSubmit!('hello agent');

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({ type: 'message', content: 'hello agent' });
  });

  it('does not call onSubmit for empty input', () => {
    const onSubmit = vi.fn();
    render(React.createElement(InputBar, { status: 'ready', onSubmit }));

    textInputOnSubmit!('   ');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit with slash command when prefixed', () => {
    const onSubmit = vi.fn();
    render(React.createElement(InputBar, { status: 'ready', onSubmit }));

    textInputOnSubmit!('/help');

    expect(onSubmit).toHaveBeenCalledWith({ type: 'help' });
  });
});
