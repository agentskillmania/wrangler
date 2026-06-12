import React from 'react';
import { render } from 'ink-testing-library';
import { TimelineEntry } from '../../../src/components/timeline-entry.js';
import type { TimelineEntry as TEntry } from '../../../src/types.js';

const baseEntry = {
  id: 'test-id',
  seq: 1,
  timestamp: Date.now(),
};

describe('TimelineEntry', () => {
  it('renders user entry content', () => {
    const entry: TEntry = { ...baseEntry, type: 'user', content: 'Hello world' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('Hello world');
    expect(lastFrame()).toContain('❯');
  });

  it('renders assistant entry content without streaming cursor', () => {
    const entry: TEntry = { ...baseEntry, type: 'assistant', content: 'I am helping' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('I am helping');
    expect(lastFrame()).not.toContain('▌');
  });

  it('shows streaming cursor when isStreaming is true', () => {
    const entry: TEntry = { ...baseEntry, type: 'assistant', content: 'Thinking...', isStreaming: true };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('Thinking...');
    expect(lastFrame()).toContain('▌');
  });

  it('renders tool entry with tool name and summary', () => {
    const entry: TEntry = { ...baseEntry, type: 'tool', tool: 'read_file', summary: 'Read file contents' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('read_file');
    expect(lastFrame()).toContain('Read file contents');
  });

  it('shows "(running)" when isRunning is true', () => {
    const entry: TEntry = { ...baseEntry, type: 'tool', tool: 'shell', summary: 'executing', isRunning: true };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('(running)');
  });

  it('renders tool entry without summary', () => {
    const entry: TEntry = { ...baseEntry, type: 'tool', tool: 'grep', summary: '' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('grep');
    // Empty summary should not crash and should render the trailing dash
    expect(lastFrame()).toContain('──');
  });

  it('renders error entry with message', () => {
    const entry: TEntry = { ...baseEntry, type: 'error', message: 'Something went wrong' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('Something went wrong');
    expect(lastFrame()).toContain('✗');
  });

  it('renders subagent-card running status', () => {
    const entry: TEntry = { ...baseEntry, type: 'subagent-card', agentName: 'searcher', status: 'running', summary: 'Searching files...' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('searcher');
    expect(lastFrame()).toContain('Running...');
    expect(lastFrame()).toContain('Searching files...');
  });

  it('renders subagent-card completed status with session hint', () => {
    const entry: TEntry = { ...baseEntry, type: 'subagent-card', agentName: 'coder', status: 'completed', summary: 'Done coding' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('coder');
    expect(lastFrame()).toContain('Completed');
    expect(lastFrame()).toContain('→ /session coder to view');
    expect(lastFrame()).toContain('Done coding');
  });

  it('renders bare-notice with path', () => {
    const entry: TEntry = { ...baseEntry, type: 'bare-notice', path: '/my/project' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('/my/project');
    expect(lastFrame()).toContain('No agent or crew configuration found');
    expect(lastFrame()).toContain('AGENT.md');
  });

  it('renders system entry with info icon and content', () => {
    const entry: TEntry = { ...baseEntry, type: 'system', content: 'Session started' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('Session started');
    expect(lastFrame()).toContain('ℹ');
  });

  it('renders nothing for run-complete entry', () => {
    const entry: TEntry = { ...baseEntry, type: 'run-complete', result: { success: true } };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toBe('');
  });

  it('renders thought entry with streaming cursor', () => {
    const entry: TEntry = { ...baseEntry, type: 'thought', content: 'Planning...', isStreaming: true };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('Planning...');
    expect(lastFrame()).toContain('◉');
    expect(lastFrame()).toContain('▌');
  });

  it('renders thought entry without streaming cursor', () => {
    const entry: TEntry = { ...baseEntry, type: 'thought', content: 'Done planning' };
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toContain('Done planning');
    expect(lastFrame()).toContain('◉');
    expect(lastFrame()).not.toContain('▌');
  });

  it('returns null for unrecognized entry type', () => {
    // Cast to bypass TS exhaustiveness and exercise the default branch
    const entry = { ...baseEntry, type: 'unknown' } as unknown as TEntry;
    const { lastFrame } = render(React.createElement(TimelineEntry, { entry }));
    expect(lastFrame()).toBe('');
  });
});
