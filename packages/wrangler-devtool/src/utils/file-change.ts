// packages/wrangler-devtool/src/utils/file-change.ts
// 结构化文件变更应用器（create / edit / delete）

import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import { resolve } from 'node:path';
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveFilePath(file: string, cwd?: string): string {
  const resolved = cwd ? resolve(cwd, file) : resolve(file);
  const cwdResolved = cwd ? resolve(cwd) : resolve(process.cwd());

  // 安全检查：禁止逃出 cwd
  if (!resolved.startsWith(cwdResolved)) {
    throw new CliError(
      `File path escapes workspace: ${file}`,
      'PATH_ESCAPE',
      ExitCode.ValidationFailure
    );
  }

  // 安全检查：禁止操作隐藏文件
  const base = resolved.split('/').pop() ?? '';
  if (base.startsWith('.') && base !== '.') {
    throw new CliError(
      `Hidden files are not allowed: ${file}`,
      'HIDDEN_FILE',
      ExitCode.ValidationFailure
    );
  }

  return resolved;
}

async function validateChange(
  change: FileChange,
  cwd?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const filePath = resolveFilePath(change.file, cwd);

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
