// @vitest-environment jsdom

import React from 'react';
import { render } from 'ink-testing-library';
import { ConfirmDialog } from '../../../src/components/confirm-dialog.js';

// --- Mocks ---

// Capture the useInput callback so tests can invoke it with simulated keystrokes
let capturedInputHandler: ((input: string) => void) | null = null;

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: (handler: (input: string) => void) => {
      capturedInputHandler = handler;
    },
  };
});

// --- Tests ---

describe('ConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedInputHandler = null;
  });

  it('renders tool name and summary', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(
      React.createElement(ConfirmDialog, {
        toolName: 'shell',
        summary: 'Run command: ls -la',
        onResult,
      }),
    );

    const output = lastFrame();
    expect(output).toContain('shell');
    expect(output).toContain('Run command: ls -la');
  });

  it('renders the allow prompt with y/n/a options', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(
      React.createElement(ConfirmDialog, {
        toolName: 'file-write',
        summary: 'Write to /tmp/test.txt',
        onResult,
      }),
    );

    const output = lastFrame();
    expect(output).toContain('[y]es');
    expect(output).toContain('[n]o');
    expect(output).toContain('[a]lways');
  });

  it('calls onResult with "yes" when "y" key is pressed', () => {
    const onResult = vi.fn();
    render(
      React.createElement(ConfirmDialog, {
        toolName: 'shell',
        summary: 'Run command',
        onResult,
      }),
    );

    expect(capturedInputHandler).not.toBeNull();
    capturedInputHandler!('y');
    expect(onResult).toHaveBeenCalledWith('yes');
  });

  it('calls onResult with "no" when "n" key is pressed', () => {
    const onResult = vi.fn();
    render(
      React.createElement(ConfirmDialog, {
        toolName: 'shell',
        summary: 'Run command',
        onResult,
      }),
    );

    capturedInputHandler!('n');
    expect(onResult).toHaveBeenCalledWith('no');
  });

  it('calls onResult with "always" when "a" key is pressed', () => {
    const onResult = vi.fn();
    render(
      React.createElement(ConfirmDialog, {
        toolName: 'shell',
        summary: 'Run command',
        onResult,
      }),
    );

    capturedInputHandler!('a');
    expect(onResult).toHaveBeenCalledWith('always');
  });

  it('handles uppercase input by normalizing to lowercase', () => {
    const onResult = vi.fn();
    render(
      React.createElement(ConfirmDialog, {
        toolName: 'shell',
        summary: 'Run command',
        onResult,
      }),
    );

    capturedInputHandler!('Y');
    expect(onResult).toHaveBeenCalledWith('yes');

    onResult.mockClear();
    capturedInputHandler!('N');
    expect(onResult).toHaveBeenCalledWith('no');

    onResult.mockClear();
    capturedInputHandler!('A');
    expect(onResult).toHaveBeenCalledWith('always');
  });

  it('does not call onResult for unrecognized keys', () => {
    const onResult = vi.fn();
    render(
      React.createElement(ConfirmDialog, {
        toolName: 'shell',
        summary: 'Run command',
        onResult,
      }),
    );

    capturedInputHandler!('x');
    capturedInputHandler!('1');
    capturedInputHandler!(' ');
    expect(onResult).not.toHaveBeenCalled();
  });

  it('renders warning icon for tool call prompt', () => {
    const onResult = vi.fn();
    const { lastFrame } = render(
      React.createElement(ConfirmDialog, {
        toolName: 'dangerous-tool',
        summary: 'Deletes everything',
        onResult,
      }),
    );

    const output = lastFrame();
    expect(output).toContain('dangerous-tool');
    expect(output).toContain('Deletes everything');
    expect(output).toContain('Agent wants to call tool');
  });
});
