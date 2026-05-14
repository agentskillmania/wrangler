// @vitest-environment jsdom

import React from 'react';
import { render } from 'ink-testing-library';
import { StatusBar } from '../../../src/components/status-bar.js';

describe('StatusBar', () => {
  const baseProps = {
    agentName: 'test-agent',
    model: 'gpt-4',
    status: 'ready' as const,
    isCrewMode: false,
  };

  it('renders agent name, model, and "ready" status with ● indicator', () => {
    const { lastFrame } = render(React.createElement(StatusBar, baseProps));

    const output = lastFrame();
    expect(output).toContain('test-agent');
    expect(output).toContain('gpt-4');
    expect(output).toContain('●');
    expect(output).toContain('ready');
  });

  it('shows session name in brackets when isCrewMode=true and sessionName provided', () => {
    const { lastFrame } = render(
      React.createElement(StatusBar, {
        ...baseProps,
        isCrewMode: true,
        sessionName: 'my-session',
      }),
    );

    const output = lastFrame();
    expect(output).toContain('test-agent [my-session]');
  });

  it('hides session name brackets when isCrewMode=false even if sessionName is provided', () => {
    const { lastFrame } = render(
      React.createElement(StatusBar, {
        ...baseProps,
        isCrewMode: false,
        sessionName: 'my-session',
      }),
    );

    const output = lastFrame();
    expect(output).toContain('test-agent');
    expect(output).not.toContain('[my-session]');
  });

  it('shows "running" status with ● indicator', () => {
    const { lastFrame } = render(
      React.createElement(StatusBar, {
        ...baseProps,
        status: 'running',
      }),
    );

    const output = lastFrame();
    expect(output).toContain('●');
    expect(output).toContain('running');
  });

  it('shows "waiting" status with ◐ indicator', () => {
    const { lastFrame } = render(
      React.createElement(StatusBar, {
        ...baseProps,
        status: 'waiting',
      }),
    );

    const output = lastFrame();
    expect(output).toContain('◐');
    expect(output).toContain('waiting');
  });

  it('shows custom hint when provided', () => {
    const { lastFrame } = render(
      React.createElement(StatusBar, {
        ...baseProps,
        hint: 'Press Enter to continue',
      }),
    );

    const output = lastFrame();
    expect(output).toContain('Press Enter to continue');
  });

  it('shows default "Ctrl+C exit" hint when no hint provided', () => {
    const { lastFrame } = render(React.createElement(StatusBar, baseProps));

    const output = lastFrame();
    expect(output).toContain('Ctrl+C exit');
  });
});
