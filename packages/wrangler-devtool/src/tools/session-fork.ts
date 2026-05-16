// packages/wrangler-devtool/src/tools/session-fork.ts
// Session fork

import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { SessionMeta } from '@agentskillmania/wrangler';
import { CliError, ExitCode } from '../cli/options.js';

export interface ForkOptions {
  msg: number;
  name?: string;
  workspace?: string;
  /** 仅供测试使用 */
  sessionBaseDir?: string;
}

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

async function writeMeta(sessionDir: string, meta: SessionMeta): Promise<void> {
  const content = yaml.dump(meta);
  await writeFile(join(sessionDir, 'meta.yaml'), content, 'utf-8');
}

async function findSessionDir(
  sessionId: string,
  baseDir: string
): Promise<{ dir: string; meta: SessionMeta } | null> {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionDir = join(baseDir, entry.name, sessionId);
      const meta = await readMeta(sessionDir);
      if (meta) {
        return { dir: sessionDir, meta };
      }
    }
  } catch {
    // baseDir 不存在
  }
  return null;
}

async function readUserChat(sessionDir: string): Promise<string[]> {
  try {
    const content = await readFile(join(sessionDir, 'user-chat.jsonl'), 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Fork 一个 session
 *
 * @param sessionId - 源 session ID
 * @param options - fork 选项
 * @returns 新 session ID
 */
export async function forkSession(sessionId: string, options: ForkOptions): Promise<string> {
  const baseDir = options.sessionBaseDir ?? getDefaultSessionBaseDir();

  const found = await findSessionDir(sessionId, baseDir);
  if (!found) {
    throw new CliError(
      `Session not found: ${sessionId}`,
      'SESSION_NOT_FOUND',
      ExitCode.GeneralError
    );
  }

  const { dir: sourceDir, meta: sourceMeta } = found;
  const messages = await readUserChat(sourceDir);

  if (options.msg < 1 || options.msg > messages.length) {
    throw new CliError(
      `Message position ${options.msg} is out of range (1-${messages.length})`,
      'MSG_OUT_OF_RANGE',
      ExitCode.GeneralError
    );
  }

  const newId = randomUUID();
  const workspacePath = options.workspace ?? sourceMeta.workspacePath;
  const wsDir = join(baseDir, hashWorkspacePath(workspacePath));
  const newDir = join(wsDir, newId);

  await mkdir(newDir, { recursive: true });

  const now = new Date().toISOString();
  const newMeta: SessionMeta = {
    id: newId,
    workspacePath,
    createdAt: now,
    updatedAt: now,
    model: sourceMeta.model,
    messageCount: options.msg,
  };

  await writeMeta(newDir, newMeta);

  // 复制 state.json
  try {
    await copyFile(join(sourceDir, 'state.json'), join(newDir, 'state.json'));
  } catch {
    // state.json 可能不存在，忽略
  }

  // 写入截断的 user-chat.jsonl
  const truncated = messages.slice(0, options.msg).join('\n') + '\n';
  await writeFile(join(newDir, 'user-chat.jsonl'), truncated, 'utf-8');

  return newId;
}
