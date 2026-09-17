import { readdir, readFile, stat as statFn, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

import { truncateStateTurns } from '@agentskillmania/wrangler';
import type { FastifyReply } from 'fastify';

/**
 * Resolve a path relative to a root directory, preventing path traversal.
 *
 * @param root - Absolute root path
 * @param relativePath - Relative path to resolve
 * @returns Absolute resolved path within root
 * @throws Error if the resolved path escapes the root
 */
export function resolveWithinRoot(root: string, relativePath: string): string {
  const resolved = resolve(root, relativePath);
  // SEC9: relative() detects sibling-prefix escapes that startsWith misses.
  const rel = relative(root, resolved);
  if (rel.startsWith('..')) {
    throw new Error('Path outside allowed directory');
  }
  return resolved;
}

/** File entry returned by the listing endpoint */
export interface FileEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  children?: FileEntry[];
}

/** Recursively list files in a directory, excluding hidden files and node_modules */
export async function listFiles(dirPath: string, relPrefix: string): Promise<FileEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const filtered = entries.filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules');

  const result: FileEntry[] = [];
  for (const entry of filtered) {
    const fullPath = join(dirPath, entry.name);
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    try {
      const fileStat = await statFn(fullPath);
      if (fileStat.isDirectory()) {
        const children = await listFiles(fullPath, relPath);
        result.push({
          name: entry.name,
          path: relPath,
          size: 0,
          isDirectory: true,
          children,
        });
      } else {
        result.push({
          name: entry.name,
          path: relPath,
          size: fileStat.size,
          isDirectory: false,
        });
      }
    } catch {
      /* skip unreadable entries */
    }
  }

  return result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Write an SSE frame (named event) to the raw response stream.
 *
 * @param reply - Fastify reply with raw writable stream
 * @param event - SSE event name
 * @param data - Event payload (will be JSON-serialized)
 */
export function writeSSE(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Write a generic SSE message (no event name) — caught by onmessage.
 *
 * @param reply - Fastify reply with raw writable stream
 * @param data - Event payload (will be JSON-serialized)
 */
export function writeGenericSSE(reply: FastifyReply, data: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

/** truncateStateFile 的失败形状：HTTP 语义码 + 文案，由调用方包成响应。 */
export type TruncateFileError = { code: 404 | 500; error: string };

/**
 * 读盘 → 按轮截断 → 写盘（R2P-154a，/truncate 温/冷两路共用，对齐 Rust
 * 0a2cc4e 的 `truncate_on_disk`）。纯语义见 wrangler
 * `truncateStateTurns`（轮 = user 消息开启；todoList 删键；统计/计费字段
 * 不动）。非法 JSON 是 500 —— 绝不覆写原文件。成功时带回写后的 JSON
 * 文本，温路径据此重载内存态，免去读回。
 */
export async function truncateStateFile(
  statePath: string,
  keepTurns: number
): Promise<{ ok: true; keptTurns: number; json: string } | ({ ok: false } & TruncateFileError)> {
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf-8');
  } catch {
    return { ok: false, code: 404, error: 'Session state not found' };
  }
  const out = truncateStateTurns(raw, keepTurns);
  if (!out.ok) {
    return { ok: false, code: 500, error: `truncate failed: ${out.error}` };
  }
  try {
    await writeFile(statePath, out.state.json);
  } catch {
    return { ok: false, code: 500, error: 'failed to write session state' };
  }
  return { ok: true, keptTurns: out.state.keptTurns, json: out.state.json };
}
