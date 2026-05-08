import { resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { isBinaryFile as detectBinary } from 'isbinaryfile';

/** Shared configuration for all workspace tools */
export interface WorkspaceToolDeps {
  workspacePath: string;
  timeout?: number;
  maxOutputSize?: number;
}

/** Resolve a file path and verify it stays within workspace boundary */
export function resolvePath(deps: WorkspaceToolDeps, filePath: string): string {
  const absolute = resolve(deps.workspacePath, filePath);
  const prefix = deps.workspacePath + sep;
  if (absolute !== deps.workspacePath && !absolute.startsWith(prefix)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  return absolute;
}

/** Truncate output to max byte size with UTF-8 safe boundary */
export function truncateOutput(
  output: string,
  maxSize?: number
): { content: string; truncated: boolean } {
  const limit = maxSize ?? 1024 * 1024; // 1MB default
  const marker = '\n...[truncated]';
  const byteLen = Buffer.byteLength(output, 'utf8');
  if (byteLen <= limit) return { content: output, truncated: false };

  // Shrink from end until byte length fits (including marker)
  let end = output.length;
  while (end > 0 && Buffer.byteLength(output.slice(0, end) + marker, 'utf8') > limit) {
    end--;
  }
  // If end lands on a low surrogate (trailing half of a pair), back up one
  if (end > 0 && end < output.length) {
    const code = output.charCodeAt(end);
    if (code >= 0xdc00 && code <= 0xdfff) {
      end--;
    }
  }
  return { content: output.slice(0, end) + marker, truncated: true };
}

/** Detect binary files using magic bytes and extension analysis */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    return await detectBinary(filePath);
  } catch {
    return false;
  }
}
