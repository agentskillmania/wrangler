import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { forkSession } from '../../../src/tools/session-fork.js';
import { CliError } from '../../../src/cli/options.js';

describe('forkSession', () => {
  let tempDir: string;
  let sessionBaseDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
    sessionBaseDir = join(tempDir, 'sessions');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createSession(
    sessionId: string,
    workspacePath: string,
    opts: { messages?: string[] } = {}
  ) {
    const hash = createHash('md5').update(workspacePath).digest('hex');
    const dir = join(sessionBaseDir, hash, sessionId);
    mkdirSync(dir, { recursive: true });

    const meta = {
      id: sessionId,
      workspacePath,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      model: 'gpt-4',
      agentName: 'test-agent',
    };
    writeFileSync(join(dir, 'meta.yaml'), yaml.dump(meta), 'utf-8');

    if (opts.messages) {
      const lines = opts.messages.map((m) =>
        JSON.stringify({ role: 'user', content: m, timestamp: Date.now() })
      );
      writeFileSync(join(dir, 'user-chat.jsonl'), lines.join('\n') + '\n', 'utf-8');
    }

    writeFileSync(join(dir, 'state.json'), JSON.stringify({ id: sessionId }), 'utf-8');
    return dir;
  }

  it('should fork a session with truncated messages', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession('source-1', wsPath, {
      messages: ['msg1', 'msg2', 'msg3', 'msg4', 'msg5'],
    });

    const newId = await forkSession('source-1', { msg: 3, sessionBaseDir });

    expect(typeof newId).toBe('string');
    expect(newId).not.toBe('source-1');

    const hash = createHash('md5').update(wsPath).digest('hex');
    const newDir = join(sessionBaseDir, hash, newId);
    expect(existsSync(newDir)).toBe(true);

    const chatContent = readFileSync(join(newDir, 'user-chat.jsonl'), 'utf-8');
    const lines = chatContent.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    expect(existsSync(join(newDir, 'state.json'))).toBe(true);
    expect(existsSync(join(newDir, 'transcript.jsonl'))).toBe(false);
  });

  it('should reject out of range msg', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession('source-2', wsPath, {
      messages: ['msg1', 'msg2'],
    });

    await expect(forkSession('source-2', { msg: 5, sessionBaseDir })).rejects.toThrow(CliError);
  });

  it('should reject msg = 0', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession('source-0', wsPath, {
      messages: ['msg1'],
    });

    await expect(forkSession('source-0', { msg: 0, sessionBaseDir })).rejects.toThrow(CliError);
  });

  it('should reject non-existent session', async () => {
    await expect(forkSession('nonexistent', { msg: 1, sessionBaseDir })).rejects.toThrow(CliError);
  });

  it('should not modify source session', async () => {
    const wsPath = join(tempDir, 'workspace');
    const sourceDir = createSession('source-3', wsPath, {
      messages: ['msg1', 'msg2', 'msg3'],
    });

    const originalChat = readFileSync(join(sourceDir, 'user-chat.jsonl'), 'utf-8');

    await forkSession('source-3', { msg: 2, sessionBaseDir });

    const afterChat = readFileSync(join(sourceDir, 'user-chat.jsonl'), 'utf-8');
    expect(afterChat).toBe(originalChat);
  });

  it('should support custom workspace', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession('source-4', wsPath, {
      messages: ['msg1'],
    });

    const newWsPath = join(tempDir, 'new-workspace');
    const newId = await forkSession('source-4', {
      msg: 1,
      workspace: newWsPath,
      sessionBaseDir,
    });

    const hash = createHash('md5').update(newWsPath).digest('hex');
    const newDir = join(sessionBaseDir, hash, newId);
    expect(existsSync(newDir)).toBe(true);

    const meta = yaml.load(readFileSync(join(newDir, 'meta.yaml'), 'utf-8')) as Record<
      string,
      string
    >;
    expect(meta.workspacePath).toBe(newWsPath);
  });

  it('should create new meta with correct agentName', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession('source-5', wsPath, {
      messages: ['a', 'b', 'c', 'd'],
    });

    const newId = await forkSession('source-5', { msg: 2, sessionBaseDir });

    const hash = createHash('md5').update(wsPath).digest('hex');
    const meta = yaml.load(
      readFileSync(join(sessionBaseDir, hash, newId, 'meta.yaml'), 'utf-8')
    ) as Record<string, unknown>;

    expect(meta.id).toBe(newId);
    expect(meta.agentName).toBe('test-agent');
    expect(meta.model).toBe('gpt-4');
  });

  it('should handle session without user-chat.jsonl', async () => {
    const wsPath = join(tempDir, 'workspace');
    createSession('source-6', wsPath);

    await expect(forkSession('source-6', { msg: 1, sessionBaseDir })).rejects.toThrow(CliError);
  });

  it('should reject when session base dir does not exist', async () => {
    await expect(
      forkSession('any', { msg: 1, sessionBaseDir: join(tempDir, 'nonexistent') })
    ).rejects.toThrow(CliError);
  });

  it('should fork even without state.json', async () => {
    const wsPath = join(tempDir, 'workspace');
    const hash = createHash('md5').update(wsPath).digest('hex');
    const dir = join(sessionBaseDir, hash, 'no-state');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'meta.yaml'),
      yaml.dump({
        id: 'no-state',
        workspacePath: wsPath,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        model: 'gpt-4',
        agentName: 'test-agent',
      }),
      'utf-8'
    );
    writeFileSync(join(dir, 'user-chat.jsonl'), '{"role":"user","content":"hello"}\n', 'utf-8');
    // No state.json

    const newId = await forkSession('no-state', { msg: 1, sessionBaseDir });
    expect(typeof newId).toBe('string');
  });
});
