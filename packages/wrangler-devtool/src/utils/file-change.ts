// packages/wrangler-devtool/src/utils/file-change.ts
// 结构化文件变更应用器（create / edit / delete）

import { readFile, writeFile, unlink, realpath } from 'node:fs/promises';
import path, { resolve, dirname } from 'node:path';

import { fileExists } from './fs.js';
import { CliError, ExitCode } from '../cli/options.js';

export interface FileChange {
  file: string;
  type: 'create' | 'edit' | 'delete';
  old?: string;
  new?: string;
}

export interface ApplyOptions {
  dryRun?: boolean;
  cwd?: string;
}

export interface ApplyResult {
  applied: boolean;
  changes?: FileChange[];
  error?: string;
  failedChange?: FileChange;
}

function resolveFilePath(file: string, cwd?: string): string {
  const resolved = cwd ? resolve(cwd, file) : resolve(file);
  const cwdResolved = cwd ? resolve(cwd) : resolve(process.cwd());

  // Security: prevent escaping cwd via path traversal
  const relative = path.relative(cwdResolved, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CliError(
      `File path escapes project: ${file}`,
      'PATH_ESCAPE',
      ExitCode.ValidationFailure
    );
  }

  // Security: reject . and .. directory entries only; allow .dotfiles
  const basename = path.basename(resolved);
  if (basename === '.' || basename === '..') {
    throw new CliError(`Invalid path: ${file}`, 'INVALID_PATH', ExitCode.ValidationFailure);
  }

  return resolved;
}

/**
 * Resolve symlinks in the file path and verify the real path stays within cwd.
 * SEC11: a symlink inside the project could point outside (e.g. to /etc).
 * path.relative alone cannot detect this — realpath() is needed.
 *
 * For non-existent files (create mode), realpath the parent directory instead.
 */
async function assertWithinProject(filePath: string, cwd?: string): Promise<void> {
  const cwdResolved = cwd ? resolve(cwd) : resolve(process.cwd());

  // Try to resolve the file itself; if it doesn't exist (create mode),
  // resolve the parent directory.
  let realPath: string;
  try {
    realPath = await realpath(filePath);
  } catch {
    // File doesn't exist — resolve parent dir
    try {
      realPath = await realpath(dirname(filePath));
    } catch {
      // Parent doesn't exist either — nothing to check (will fail at write time)
      return;
    }
  }

  const realCwd = await realpath(cwdResolved).catch(() => cwdResolved);
  const rel = path.relative(realCwd, realPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new CliError(
      `File path escapes project via symlink: ${filePath}`,
      'PATH_ESCAPE',
      ExitCode.ValidationFailure
    );
  }
}

async function validateChange(
  change: FileChange,
  cwd?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const filePath = resolveFilePath(change.file, cwd);
    // SEC11: check symlink escape after path resolution
    await assertWithinProject(filePath, cwd);

    switch (change.type) {
      case 'create': {
        if (await fileExists(filePath)) {
          return { valid: false, error: `File already exists: ${change.file}` };
        }
        if (change.new === undefined) {
          return { valid: false, error: `Create requires 'new' content: ${change.file}` };
        }
        return { valid: true };
      }
      case 'edit': {
        if (!(await fileExists(filePath))) {
          return { valid: false, error: `File does not exist: ${change.file}` };
        }
        if (change.old === undefined || change.new === undefined) {
          return { valid: false, error: `Edit requires both 'old' and 'new': ${change.file}` };
        }
        const content = await readFile(filePath, 'utf-8');
        if (!content.includes(change.old)) {
          return { valid: false, error: `Old content not found in ${change.file}` };
        }
        return { valid: true };
      }
      case 'delete': {
        if (!(await fileExists(filePath))) {
          return { valid: false, error: `File does not exist: ${change.file}` };
        }
        return { valid: true };
      }
      default: {
        return {
          valid: false,
          error: `Unknown change type: ${(change as FileChange).type}`,
        };
      }
    }
  } catch (error) {
    if (error instanceof CliError) {
      return { valid: false, error: error.message };
    }
    throw error;
  }
}

async function applySingleChange(change: FileChange, cwd?: string): Promise<void> {
  const filePath = resolveFilePath(change.file, cwd);
  // SEC11: check symlink escape before writing/deleting
  await assertWithinProject(filePath, cwd);

  switch (change.type) {
    case 'create':
    case 'edit':
      await writeFile(filePath, change.new!, 'utf-8');
      break;
    case 'delete':
      await unlink(filePath);
      break;
  }
}

/**
 * 应用一组文件变更
 *
 * 规则：
 * 1. 先验证所有变更
 * 2. 任一验证失败则全部回滚（不写入任何文件）
 * 3. dryRun 模式下只验证不写入
 */
export async function applyChanges(
  changes: FileChange[],
  options: ApplyOptions = {}
): Promise<ApplyResult> {
  // Phase 1: 验证所有变更
  for (const change of changes) {
    const result = await validateChange(change, options.cwd);
    if (!result.valid) {
      return {
        applied: false,
        error: result.error,
        failedChange: change,
      };
    }
  }

  if (options.dryRun) {
    return { applied: false, changes, error: 'Dry run — no changes applied' };
  }

  // Phase 2: 应用所有变更
  for (const change of changes) {
    await applySingleChange(change, options.cwd);
  }

  return { applied: true, changes };
}
