import { SessionStore } from '@agentskillmania/wrangler';
import type { SessionMeta } from '@agentskillmania/wrangler';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { readMeta } from '@agentskillmania/wrangler';

export function getDefaultSessionBaseDir(): string {
  return (
    process.env.WRANGLER_DEVTOOL_SESSION_DIR ??
    join(homedir(), '.agentskillmania', 'wrangler', 'sessions')
  );
}

export function hashWorkspacePath(workspacePath: string): string {
  const absolute = resolve(workspacePath);
  return createHash('md5').update(absolute).digest('hex');
}

export async function findSessionGlobally(
  sessionId: string,
  baseDir: string
): Promise<{ store: SessionStore; meta: SessionMeta } | null> {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsDir = join(baseDir, entry.name);
      const sessionDir = join(wsDir, sessionId);
      const meta = await readMeta(sessionDir);
      if (meta) {
        const store = new SessionStore(baseDir, meta.workspacePath);
        return { store, meta };
      }
    }
  } catch {
    // baseDir doesn't exist
  }
  return null;
}
