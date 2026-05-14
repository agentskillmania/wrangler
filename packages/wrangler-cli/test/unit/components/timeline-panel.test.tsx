// @vitest-environment jsdom

import React from 'react';
import { render } from 'ink-testing-library';
import { TimelinePanel } from '../../../src/components/timeline-panel.js';
import type { TimelineEntry } from '../../../src/types.js';

describe('TimelinePanel', () => {
  it('renders empty container when no entries', () => {
    const { lastFrame } = render(
      React.createElement(TimelinePanel, { entries: [] }),
    );

    const output = lastFrame();
    // An empty Box still produces whitespace-only output, not null.
    // Verify no entry content is rendered.
    expect(output).toBeDefined();
    expect(output!.trim()).toBe('');
  });

  it('renders each entry with correct content', () => {
    const entries: TimelineEntry[] = [
      {
        type: 'user',
        id: '1',
        seq: 1,
        content: 'Hello from user',
        timestamp: Date.now(),
      },
      {
        type: 'assistant',
        id: '2',
        seq: 2,
        content: 'Hello from assistant',
        timestamp: Date.now(),
      },
      {
        type: 'tool',
        id: '3',
        seq: 3,
        tool: 'shell',
        summary: 'ran ls command',
        timestamp: Date.now(),
      },
    ];

    const { lastFrame } = render(
      React.createElement(TimelinePanel, { entries }),
    );

    const output = lastFrame();
    expect(output).toContain('Hello from user');
    expect(output).toContain('Hello from assistant');
    expect(output).toContain('shell');
    expect(output).toContain('ran ls command');
  });

  it('renders error entries', () => {
    const entries: TimelineEntry[] = [
      {
        type: 'error',
        id: 'err-1',
        seq: 1,
        message: 'Something went wrong',
        timestamp: Date.now(),
      },
    ];

    const { lastFrame } = render(
      React.createElement(TimelinePanel, { entries }),
    );

    expect(lastFrame()).toContain('Something went wrong');
  });

  it('renders system entries', () => {
    const entries: TimelineEntry[] = [
      {
        type: 'system',
        id: 'sys-1',
        seq: 1,
        content: 'Session started',
        timestamp: Date.now(),
      },
    ];

    const { lastFrame } = render(
      React.createElement(TimelinePanel, { entries }),
    );

    expect(lastFrame()).toContain('Session started');
  });

  it('renders subagent-card entries', () => {
    const entries: TimelineEntry[] = [
      {
        type: 'subagent-card',
        id: 'sa-1',
        seq: 1,
        agentName: 'coder',
        status: 'running',
        summary: 'Writing code...',
        timestamp: Date.now(),
      },
    ];

    const { lastFrame } = render(
      React.createElement(TimelinePanel, { entries }),
    );

    const output = lastFrame();
    expect(output).toContain('coder');
    expect(output).toContain('Running...');
  });
});
