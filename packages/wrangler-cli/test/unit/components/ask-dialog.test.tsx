/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render } from 'ink-testing-library';

// Capture TextInput onSubmit callback
let capturedOnSubmit: ((value: string) => void) | null = null;

vi.mock('@inkjs/ui', async () => {
  const { Text } = await import('ink');
  return {
    TextInput: (props: { onSubmit: (value: string) => void; placeholder?: string }) => {
      capturedOnSubmit = props.onSubmit;
      return React.createElement(Text, null, `TextInput[${props.placeholder}]`);
    },
    Select: () => null,
  };
});

import { AskDialog } from '../../../src/components/ask-dialog.js';

describe('AskDialog', () => {
  beforeEach(() => {
    capturedOnSubmit = null;
  });

  it('renders question text', () => {
    const { lastFrame } = render(
      React.createElement(AskDialog, { question: 'What is your name?', onAnswer: vi.fn() })
    );
    expect(lastFrame()).toContain('What is your name?');
  });

  it('renders answer input with placeholder', () => {
    const { lastFrame } = render(
      React.createElement(AskDialog, { question: 'test?', onAnswer: vi.fn() })
    );
    expect(lastFrame()).toContain('Type your answer...');
  });

  it('calls onAnswer with trimmed value on submit', () => {
    const onAnswer = vi.fn();
    render(React.createElement(AskDialog, { question: 'q?', onAnswer }));

    capturedOnSubmit!('  hello  ');
    expect(onAnswer).toHaveBeenCalledWith('hello');
  });

  it('does not call onAnswer for empty/whitespace-only input', () => {
    const onAnswer = vi.fn();
    render(React.createElement(AskDialog, { question: 'q?', onAnswer }));

    capturedOnSubmit!('   ');
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('renders agent asks label', () => {
    const { lastFrame } = render(
      React.createElement(AskDialog, { question: 'q?', onAnswer: vi.fn() })
    );
    expect(lastFrame()).toContain('Agent asks');
  });
});
