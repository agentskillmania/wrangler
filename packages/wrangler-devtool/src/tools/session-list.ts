// packages/wrangler-devtool/src/tools/session-list.ts
// Session 列表

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { SessionMeta } from '@agentskillmania/wrangler';

function getDefaultSessionBaseDir(): string {
  return (
    process.env.WRANGLER_DEVTOOL_SESSION_DIR ??
    join(homedir(), '.agentskillmania', 'wrangler', 'sessions')
  );
}

function hashWorkspacePath(workspacePath: string): string {
  const absolute = resolve(workspacePath);
  return createHash('md5').update(absolute).digest('hex');
}

async function readMeta(sessionDir: string): Promise<SessionMeta | null> {
  try {
    const content = await readFile(join(sessionDir, 'meta.yaml'), 'utf-8');
    return yaml.load(content) as SessionMeta;
  } catch {
    return null;
  }
}

/**
 * 列出 workspace 的所有 session
 *
 * @param workspacePath - workspace 路径（默认当前目录）
 * @param sessionBaseDir - session 根目录（用于测试）
 */
export async function listSessions(
  workspacePath?: string,
  sessionBaseDir?: string
): Promise<SessionMeta[]> {
  const wsPath = workspacePath ? resolve(workspacePath) : resolve(process.cwd());
  const baseDir = sessionBaseDir ?? getDefaultSessionBaseDir();
  const wsDir = join(baseDir, hashWorkspacePath(wsPath));

  const metas: SessionMeta[] = [];

  try {
    const entries = await readdir(wsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readMeta(join(wsDir, entry.name));
      if (meta) {
        metas.push(meta);
      }
    }
  } catch {
    // 目录不存在或为空
    return [];
  }

  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
