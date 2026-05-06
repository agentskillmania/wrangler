import { resolve, sep, extname } from 'node:path';
import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

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

const BINARY_EXTENSIONS = new Set([
  '.zip',
  '.exe',
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
  '.so',
  '.dll',
  '.dylib',
  '.o',
  '.class',
  '.sqlite',
  '.db',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.jar',
  '.war',
  '.apk',
  '.dmg',
  '.iso',
  '.bin',
  '.dat',
]);

/** Detect binary files via extension whitelist + byte sampling */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;

  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buf, 0, 4096, 0);
    if (bytesRead === 0) return false;

    let nonPrintable = 0;
    for (let i = 0; i < bytesRead; i++) {
      const b = buf[i];
      if ((b < 32 && b !== 9 && b !== 10 && b !== 13) || b > 126) {
        nonPrintable++;
      }
    }
    return nonPrintable / bytesRead > 0.3;
  } finally {
    await handle.close();
  }
}
