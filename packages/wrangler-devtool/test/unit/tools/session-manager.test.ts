import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { SessionStore } from '@agentskillmania/wrangler';
import type { SessionEntry } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage, addAssistantMessage } from '@agentskillmania/colts';
import type { Message, AgentState } from '@agentskillmania/colts';
import { produce } from 'immer';
import { forkSession, listSessions } from '../../../src/tools/session-manager.js';

function hashWorkspacePath(workspacePath: string): string {
  return createHash('md5').update(resolve(workspacePath)).digest('hex');
}

/**
 * Assign UUID ids to messages that don't have them.
 * In real runtime, AgentRunner ensures messages have ids.
 * addUserMessage/addAssistantMessage from colts don't set ids in test environment.
 * State is deep-frozen by colts, use immer produce to mutate.
 */
function ensureMessageIds(state: AgentState): AgentState {
  return produce(state, (draft) => {
    for (const msg of draft.context.messages) {
      if (!msg.id) {
        (msg as Message & { id?: string }).id = randomUUID();
      }
    }
  });
}

describe('forkSession', () => {
  let baseDir: string;
  const workspacePath = '/tmp/fork-test-ws';

  beforeEach(async () => {
    baseDir = join(tmpdir(), `fork-test-${Date.now()}`);
    await mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  async function createSourceSession(sessionId: string): Promise<{
    entries: SessionEntry[];
    messageIds: { user1: string; assistant1: string; user2: string; assistant2: string };
  }> {
    const store = new SessionStore(baseDir, workspacePath);
    await store.createWithId(sessionId, 'gpt-4', 'test-agent');

    let state = createAgentState({ name: 'test', instructions: 'test', tools: [] });
    state = addUserMessage(state, 'Hello');
    state = ensureMessageIds(state);
    const user1Id = state.context.messages[0].id!;

    state = addAssistantMessage(state, 'Hi there');
    state = ensureMessageIds(state);
    const assistant1Id = state.context.messages[1].id!;

    state = addUserMessage(state, 'How are you?');
    state = ensureMessageIds(state);
    const user2Id = state.context.messages[2].id!;

    state = addAssistantMessage(state, 'I am fine');
    state = ensureMessageIds(state);
    const assistant2Id = state.context.messages[3].id!;

    await store.saveState(sessionId, state);

    // Create entries that match real wrangler behavior:
    // user msg entry -> id = message.id
    // tool entry -> id = randomUUID (not in messages)
    // assistant msg entry -> id = message.id
    const entries: SessionEntry[] = [
      { id: user1Id, role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: randomUUID(), role: 'tool', content: '{"result": "ok"}', timestamp: Date.now(), toolName: 'test_tool', toolArguments: '{}' },
      { id: assistant1Id, role: 'assistant', content: 'Hi there', timestamp: Date.now() },
      { id: user2Id, role: 'user', content: 'How are you?', timestamp: Date.now() },
      { id: assistant2Id, role: 'assistant', content: 'I am fine', timestamp: Date.now() },
    ];

    for (const entry of entries) {
      await store.appendEntry(sessionId, entry);
    }

    return { entries, messageIds: { user1: user1Id, assistant1: assistant1Id, user2: user2Id, assistant2: assistant2Id } };
  }

  it('creates a new session truncated to the specified message id', async () => {
    const sessionId = 'source-session';
    const { entries, messageIds } = await createSourceSession(sessionId);

    // Fork after the 4th entry (user2 message, index 3)
    const cutoffId = entries[3].id;
    const newId = await forkSession(sessionId, {
      upToMessageId: cutoffId,
      sessionBaseDir: baseDir,
    });

    // Verify new session exists and can be resumed
    const newStore = new SessionStore(baseDir, workspacePath);
    const resumed = await newStore.resume(newId);
    expect(resumed).not.toBeNull();

    // Verify entries are truncated: first 4 entries (indices 0-3)
    const newEntries = resumed!.recentEntries;
    expect(newEntries).toHaveLength(4);
    expect(newEntries[0].id).toBe(entries[0].id);
    expect(newEntries[1].id).toBe(entries[1].id);
    expect(newEntries[2].id).toBe(entries[2].id);
    expect(newEntries[3].id).toBe(entries[3].id);

    // Verify state messages are truncated correctly:
    // user1 + assistant1 + user2 (assistant2 is after cutoff)
    const messageIds_in_state = resumed!.state.context.messages.map((m) => m.id);

    // Messages before cutoff should be preserved
    expect(messageIds_in_state).toContain(messageIds.user1);
    expect(messageIds_in_state).toContain(messageIds.assistant1);
    expect(messageIds_in_state).toContain(messageIds.user2);

    // Message after cutoff should NOT be preserved
    expect(messageIds_in_state).not.toContain(messageIds.assistant2);
  });

  it('truncates correctly when cutoff is on a tool entry', async () => {
    const sessionId = 'source-session-tool';
    const { entries, messageIds } = await createSourceSession(sessionId);

    // Cutoff is on the tool entry (index 1)
    const toolEntryId = entries[1].id;
    const newId = await forkSession(sessionId, {
      upToMessageId: toolEntryId,
      sessionBaseDir: baseDir,
    });

    const newStore = new SessionStore(baseDir, workspacePath);
    const resumed = await newStore.resume(newId);
    expect(resumed).not.toBeNull();

    // Entries should include user1 + tool
    expect(resumed!.recentEntries).toHaveLength(2);
    expect(resumed!.recentEntries[1].id).toBe(toolEntryId);
    expect(resumed!.recentEntries[1].role).toBe('tool');

    // Messages should include user1 only (assistant1 is after tool)
    const messageIds_in_state = resumed!.state.context.messages.map((m) => m.id);
    expect(messageIds_in_state).toContain(messageIds.user1);
    expect(messageIds_in_state).not.toContain(messageIds.assistant1);
  });

  it('throws when message id is not found', async () => {
    const sessionId = 'source-session';
    await createSourceSession(sessionId);

    await expect(
      forkSession(sessionId, {
        upToMessageId: 'non-existent-id',
        sessionBaseDir: baseDir,
      })
    ).rejects.toThrow('Message ID not found');
  });

  it('throws when source session does not exist', async () => {
    await expect(
      forkSession('non-existent', {
        upToMessageId: 'any-id',
        sessionBaseDir: baseDir,
      })
    ).rejects.toThrow('Session not found');
  });

  it('supports cross-workspace fork', async () => {
    const sessionId = 'cross-ws-session';
    const { entries } = await createSourceSession(sessionId);
    const newWorkspace = '/tmp/new-workspace';

    const newId = await forkSession(sessionId, {
      upToMessageId: entries[0].id,
      workspace: newWorkspace,
      sessionBaseDir: baseDir,
    });

    // Verify new session is in the new workspace
    const newStore = new SessionStore(baseDir, newWorkspace);
    const resumed = await newStore.resume(newId);
    expect(resumed).not.toBeNull();
    expect(resumed!.meta.workspacePath).toBe(newWorkspace);
  });
});

describe('listSessions', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = join(tmpdir(), `list-test-${Date.now()}`);
    await mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('lists sessions for a single workspace', async () => {
    const wsPath = '/tmp/list-ws';
    const store = new SessionStore(baseDir, wsPath);
    await store.createWithId('session-a', 'gpt-4', 'agent-a');
    await store.createWithId('session-b', 'gpt-4', 'agent-b');

    const sessions = await listSessions({ workspacePath: wsPath, sessionBaseDir: baseDir });

    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['session-a', 'session-b']);
  });

  it('lists sessions across all workspaces', async () => {
    const storeA = new SessionStore(baseDir, '/tmp/ws-a');
    const storeB = new SessionStore(baseDir, '/tmp/ws-b');
    await storeA.createWithId('session-a', 'gpt-4', 'agent-a');
    await storeB.createWithId('session-b', 'gpt-4', 'agent-b');

    const sessions = await listSessions({ sessionBaseDir: baseDir, allWorkspaces: true });

    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.id).sort();
    expect(ids).toEqual(['session-a', 'session-b']);
  });

  it('returns empty array when no sessions exist', async () => {
    const sessions = await listSessions({ workspacePath: '/tmp/empty', sessionBaseDir: baseDir });
    expect(sessions).toEqual([]);
  });

  it('sorts by createdAt descending', async () => {
    const wsPath = '/tmp/sort-ws';
    const store = new SessionStore(baseDir, wsPath);

    // Create sessions with delays to ensure different createdAt
    await store.createWithId('older', 'gpt-4', 'agent');
    await new Promise((r) => setTimeout(r, 50));
    await store.createWithId('newer', 'gpt-4', 'agent');

    const sessions = await listSessions({ workspacePath: wsPath, sessionBaseDir: baseDir });

    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('newer');
    expect(sessions[1].id).toBe('older');
  });

  it('sorts allWorkspaces by createdAt descending', async () => {
    const storeA = new SessionStore(baseDir, '/tmp/ws-a');
    const storeB = new SessionStore(baseDir, '/tmp/ws-b');

    await storeA.createWithId('older', 'gpt-4', 'agent');
    await new Promise((r) => setTimeout(r, 50));
    await storeB.createWithId('newer', 'gpt-4', 'agent');

    const sessions = await listSessions({ sessionBaseDir: baseDir, allWorkspaces: true });

    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('newer');
    expect(sessions[1].id).toBe('older');
  });
});
