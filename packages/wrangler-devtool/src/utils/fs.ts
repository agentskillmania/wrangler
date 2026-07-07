// packages/wrangler-devtool/src/utils/fs.ts
// Shared filesystem helpers

import { access } from 'node:fs/promises';

/**
 * Check whether a file or directory exists at the given path.
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
