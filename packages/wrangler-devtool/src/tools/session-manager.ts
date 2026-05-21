import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionStore } from '@agentskillmania/wrangler';
import type { SessionMeta } from '@agentskillmania/wrangler';
import type { AgentState } from '@agentskillmania/colts';
import { findSessionGlobally, getDefaultSessionBaseDir } from './session-utils.js';
import { CliError, ExitCode } from '../cli/options.js';

export interface ForkOptions {
  /** Truncate to this message ID (inclusive) */
  upToMessageId: string;
  /** Override workspace for the new session (defaults to source workspace) */
  workspace?: string;
  /** Override session base directory (for testing) */
  sessionBaseDir?: string;
}

export interface ListOptions {
  workspacePath?: string;
  sessionBaseDir?: string;
  allWorkspaces?: boolean;
}

/**
 * Fork a session from a historical message.
 *
 * Creates a new session containing all entries up to and including
 * the specified message ID. The AgentState is also truncated to match.
 */
export async function forkSession(
  sessionId: string,
  options: ForkOptions
): Promise<string> {
  const baseDir = options.sessionBaseDir ?? getDefaultSessionBaseDir();

  // 1. Find source session
  const found = await findSessionGlobally(sessionId, baseDir);
  if (!found) {
    throw new CliError(
      `Session not found: ${sessionId}`,
      'SESSION_NOT_FOUND',
      ExitCode.GeneralError
    );
  }

  const { store: sourceStore, meta: sourceMeta } = found;

  // 2. Load full state + entries
  const resumed = await sourceStore.resume(sessionId);
  if (!resumed) {
    throw new CliError(
      `Failed to resume session: ${sessionId}`,
      'RESUME_FAILED',
      ExitCode.GeneralError
    );
  }

  const { state: sourceState, recentEntries: allEntries } = resumed;

  // 3. Find cutoff point
  const cutoffIndex = allEntries.findIndex((e) => e.id === options.upToMessageId);
  if (cutoffIndex === -1) {
    throw new CliError(
      `Message ID not found: ${options.upToMessageId}`,
      'MSG_ID_NOT_FOUND',
      ExitCode.GeneralError
    );
  }

  const truncatedEntries = allEntries.slice(0, cutoffIndex + 1);

  // 4. Truncate state.messages
  const keepMessageIds = new Set(truncatedEntries.map((e) => e.id));
  const truncatedMessages = sourceState.context.messages.filter((m) => {
    const msgId = (m as { id?: string }).id;
    return (msgId !== undefined && keepMessageIds.has(msgId)) || m.role === 'system';
  });

  const truncatedState: AgentState = {
    ...sourceState,
    context: {
      ...sourceState.context,
      messages: truncatedMessages,
    },
  };

  // 5. Create new session
  const newId = randomUUID();
  const workspacePath = options.workspace ?? sourceMeta.workspacePath;
  const targetStore = new SessionStore(baseDir, workspacePath);

  await targetStore.createWithId(newId, sourceMeta.model, sourceMeta.agentName);
  await targetStore.saveState(newId, truncatedState);

  for (const entry of truncatedEntries) {
    await targetStore.appendEntry(newId, entry);
  }

  return newId;
}

/**
 * List sessions.
 *
 * By default lists sessions for the current workspace.
 * Pass `allWorkspaces: true` to list across all workspaces.
 */
export async function listSessions(options?: ListOptions): Promise<SessionMeta[]> {
  const baseDir = options?.sessionBaseDir ?? getDefaultSessionBaseDir();

  if (options?.allWorkspaces) {
    const allMetas: SessionMeta[] = [];
    try {
      const entries = await readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const wsDir = join(baseDir, entry.name);
        const sessions = await listWorkspaceSessions(wsDir);
        allMetas.push(...sessions);
      }
    } catch {
      // baseDir doesn't exist
    }
    return allMetas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const workspacePath = options?.workspacePath ?? process.cwd();
  const store = new SessionStore(baseDir, workspacePath);
  return store.listSessions();
}

async function listWorkspaceSessions(wsDir: string): Promise<SessionMeta[]> {
  const { readdir } = await import('node:fs/promises');
  const { readMeta } = await import('@agentskillmania/wrangler');
  const metas: SessionMeta[] = [];
  try {
    const entries = await readdir(wsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readMeta(join(wsDir, entry.name));
      if (meta) metas.push(meta);
    }
  } catch {
    // ignore
  }
  return metas;
}
