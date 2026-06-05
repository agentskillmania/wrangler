import { describe, it, expect } from 'vitest';
import type { SessionMeta } from '../../src/types.js';

describe('SessionMeta', () => {
  it('accepts optional title', () => {
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
});
