import { resolve, sep } from 'node:path';
import { Buffer } from 'node:buffer';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { isBinaryFile as detectBinary } from 'isbinaryfile';
import { glob as fglob } from 'fast-glob';
import { rgPath } from 'ripgrep';

const execAsync = promisify(exec);

/** Result of command execution */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Shared configuration for all workspace tools */
export interface WorkspaceToolDeps {
  workspacePath: string;
  timeout?: number;
  maxOutputSize?: number;
}

/**
 * Abstract interface for tool dependencies (filesystem, execution, search).
 * This allows tools to work in different environments (host, sandbox, etc.)
 * without knowing the implementation details.
 */
export interface ToolDeps {
  /** Root directory of the workspace */
  readonly workspaceRoot: string;

  /** Maximum output size in bytes */
  readonly maxOutputSize: number;

  /** Resolve a relative path within workspace and verify it stays within bounds */
  resolvePath(filePath: string): string;

  /** Execute a shell command */
  exec(command: string, options?: { timeout?: number }): Promise<ExecResult>;

  /** Read file content as text */
  readFile(filePath: string): Promise<string>;

  /** Write file content, creating parent directories if needed */
  writeFile(filePath: string, content: string): Promise<void>;

  /** Edit file by replacing string occurrences */
  editFile(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean
  ): Promise<string>;

  /** Find files matching a glob pattern */
  glob(pattern: string, options?: { cwd?: string }): Promise<string[]>;

  /** Search for a pattern in files */
  grep(pattern: string, path: string, options?: { cwd?: string }): Promise<string>;
}

/**
 * Host-based implementation of ToolDeps using Node.js native APIs.
 * All operations run directly on the host system.
 */
export class HostToolDeps implements ToolDeps {
  readonly workspaceRoot: string;
  readonly maxOutputSize: number;

  constructor(workspaceRoot: string, maxOutputSize: number = 1024 * 1024) {
    this.workspaceRoot = workspaceRoot;
    this.maxOutputSize = maxOutputSize;
  }

  resolvePath(filePath: string): string {
    const absolute = resolve(this.workspaceRoot, filePath);
    const prefix = this.workspaceRoot + sep;
    if (absolute !== this.workspaceRoot && !absolute.startsWith(prefix)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    return absolute;
  }

  async exec(command: string, options?: { timeout?: number }): Promise<ExecResult> {
    const timeout = options?.timeout ?? 30000;
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: this.maxOutputSize,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        exitCode: err.code ?? 1,
      };
    }
  }

  async readFile(filePath: string): Promise<string> {
    const absolute = this.resolvePath(filePath);
    return await readFile(absolute, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const absolute = this.resolvePath(filePath);
    const directory = resolve(absolute, '..');
    await mkdir(directory, { recursive: true });
    await writeFile(absolute, content, 'utf-8');
  }

  async editFile(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll: boolean = false
  ): Promise<string> {
    if (oldString === newString) {
      return 'Error: oldString and newString are identical';
    }

    const content = await this.readFile(filePath);

    if (!content.includes(oldString)) {
      return `Error: "${oldString}" not found in file`;
    }

    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    const count = replaceAll
      ? (content.match(new RegExp(oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? [])
          .length
      : content.includes(oldString)
        ? 1
        : 0;

    await this.writeFile(filePath, newContent);
    return `Successfully replaced ${count} occurrence${count === 1 ? '' : 's'}`;
  }

  async glob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
    const cwd = options?.cwd ?? this.workspaceRoot;
    const files = await fglob(pattern, {
      cwd,
      absolute: true,
      onlyFiles: true,
    });
    return files;
  }

  async grep(pattern: string, path: string, options?: { cwd?: string }): Promise<string> {
    const cwd = options?.cwd ?? this.workspaceRoot;
    const searchPath = resolve(cwd, path);
    const args = [pattern, searchPath, '--no-heading', '--line-number'];

    try {
      const result = await this.exec(`${rgPath} ${args.join(' ')}`);
      return result.stdout || 'No matches found';
    } catch {
      return 'No matches found';
    }
  }
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
