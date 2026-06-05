import { describe, it, expect } from 'vitest';
import type {
  SessionMeta,
  SessionOverview,
  SessionInfo,
  SessionDiagnostics,
} from '../../src/types.js';

describe('Session Types', () => {
  it('SessionMeta accepts optional title', () => {
    const withoutTitle: SessionMeta = {
      id: '123-abc',
      workspacePath: '/tmp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      model: 'gpt-4',
      agentName: 'test-agent',
    };
    expect(withoutTitle.title).toBeUndefined();

    const withTitle: SessionMeta = {
      ...withoutTitle,
      title: 'Fix auth bug',
    };
    expect(withTitle.title).toBe('Fix auth bug');
  });

  it('SessionOverview has required fields', () => {
    const overview: SessionOverview = {
      agentName: 'debug-agent',
      model: 'claude-sonnet-4-6',
      stepCount: 12,
      messageCount: 47,
      status: 'running',
      createdAt: '2026-01-01T14:32:00Z',
      updatedAt: '2026-01-01T14:33:00Z',
    };
    expect(overview.agentName).toBe('debug-agent');
    expect(overview.title).toBeUndefined();
    expect(overview.tokensIn).toBeUndefined();
    expect(overview.contextWindow).toBeUndefined();
  });

  it('SessionInfo has required fields', () => {
    const info: SessionInfo = {
      sessionId: '123-abc',
      agentName: 'debug-agent',
      model: 'claude-sonnet-4-6',
      workspacePath: '/Users/dev/project',
      skillDirs: ['/skills'],
      mcpConfigPaths: [],
    };
    expect(info.sessionId).toBe('123-abc');
    expect(info.agentConfigPath).toBeUndefined();
  });

  it('SessionDiagnostics composes overview and info', () => {
    const diag: SessionDiagnostics = {
      overview: {
        agentName: 'debug-agent',
        model: 'gpt-4',
        stepCount: 0,
        messageCount: 0,
        status: 'idle',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      info: {
        sessionId: '1',
        agentName: 'debug-agent',
        model: 'gpt-4',
        workspacePath: '/tmp',
        skillDirs: [],
        mcpConfigPaths: [],
      },
    };
    expect(diag.overview.status).toBe('idle');
    expect(diag.info.sessionId).toBe('1');
  });
});
