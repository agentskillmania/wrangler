import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { listSessions } from '../../../src/tools/session-list.js';

describe('listSessions', () => {
  let tempDir: string;
  let sessionBaseDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
    sessionBaseDir = join(tempDir, 'sessions');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSession(workspacePath: string, sessionId: string, meta: Record<string, unknown>) {
    const hash = createHash('md5').update(workspacePath).digest('hex');
    const dir = join(sessionBaseDir, hash, sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.yaml'), yaml.dump(meta), 'utf-8');
  }

  it('should return empty array when no sessions', async () => {
    const sessions = await listSessions(tempDir, sessionBaseDir);
    expect(sessions).toEqual([]);
  });

  it('should list sessions sorted by updatedAt descending', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession(wsPath, 'session-1', {
      id: 'session-1',
      workspacePath: wsPath,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-03T00:00:00Z',
      model: 'gpt-4',
      messageCount: 5,
    });
    createSession(wsPath, 'session-2', {
      id: 'session-2',
      workspacePath: wsPath,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      model: 'gpt-4',
      messageCount: 3,
    });

    const sessions = await listSessions(wsPath, sessionBaseDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('session-1');
    expect(sessions[1].id).toBe('session-2');
  });

  it('should filter by workspace path', async () => {
    const ws1 = join(tempDir, 'workspace1');
    const ws2 = join(tempDir, 'workspace2');

    createSession(ws1, 's1', {
      id: 's1',
      workspacePath: ws1,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      model: 'gpt-4',
      messageCount: 1,
    });
    createSession(ws2, 's2', {
      id: 's2',
      workspacePath: ws2,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      model: 'gpt-4',
      messageCount: 1,
    });

    const sessions = await listSessions(ws1, sessionBaseDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('s1');
  });

  it('should ignore invalid session directories', async () => {
    const wsPath = join(tempDir, 'workspace');
    const hash = createHash('md5').update(wsPath).digest('hex');
    const dir = join(sessionBaseDir, hash, 'bad-session');
    mkdirSync(dir, { recursive: true });
    // No meta.yaml

    const sessions = await listSessions(wsPath, sessionBaseDir);
    expect(sessions).toEqual([]);
  });

  it('should ignore sessions with invalid meta.yaml', async () => {
    const wsPath = join(tempDir, 'workspace');
    const hash = createHash('md5').update(wsPath).digest('hex');
    const dir = join(sessionBaseDir, hash, 'bad-meta');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'meta.yaml'), 'not: valid: yaml: [', 'utf-8');

    const sessions = await listSessions(wsPath, sessionBaseDir);
    expect(sessions).toEqual([]);
  });
});
