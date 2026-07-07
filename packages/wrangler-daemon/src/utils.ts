import { readdir, stat as statFn } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

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
