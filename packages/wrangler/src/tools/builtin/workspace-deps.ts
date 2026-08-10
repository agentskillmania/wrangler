import { Buffer } from 'node:buffer';
import { exec, execFile, execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { resolve, sep, join, basename, dirname } from 'node:path';
import { promisify } from 'node:util';

import type { Sandbox } from '@agentskillmania/sandbox';
import fglob from 'fast-glob';
import { isBinaryFile as detectBinary } from 'isbinaryfile';
import { rgPath } from 'ripgrep';
import { quote } from 'shell-quote';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Default tool-output truncation cap (characters) — single source of truth
 * shared by the tool-deps defaults, `createBuiltinTools`, and the enhanced
 * runner (`runner.limits.maxToolOutput ?? this`). Same name + value as the
 * Rust `DEFAULT_MAX_TOOL_OUTPUT` (defined in the mirror file
 * `workspace_deps.rs`).
 */
export const DEFAULT_MAX_TOOL_OUTPUT = 100_000;

/**
 * Wrap a string in POSIX single-quotes, escaping internal single-quotes via
 * the '\'' sequence. Inside single quotes every character is literal — no
 * command substitution ($()), backticks, semicolons, or glob expansion can
 * occur. This is the safe way to interpolate untrusted content (e.g. an LLM
 * regex) into a shell command string when the executor only accepts a string
 * (such as the WASM sandbox's wsh).
 */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Detected shell information */
export interface ShellInfo {
  /** Shell executable path */
  path: string;
  /** Human-readable shell name (e.g. 'bash', 'zsh', 'pwsh', 'cmd') */
  name: string;
}

/**
 * Find executable in PATH using platform-appropriate method.
 * On Unix uses `which`, on Windows uses `where`.
 */
function which(command: string): string | undefined {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = execSync(`${finder} ${command}`, {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const firstLine = result.split('\n')[0]?.trim();
    return firstLine || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Locate Git Bash on Windows by finding git.exe and deriving bash.exe path.
 * Git Bash's bash.exe may not be in PATH, but git.exe almost always is.
 */
function findGitBash(): string | undefined {
  if (process.platform !== 'win32') return undefined;

  const envOverride = process.env.WRANGLER_GIT_BASH_PATH;
  if (envOverride) return envOverride;

  const gitPath = which('git');
  if (!gitPath) return undefined;

  // git.exe lives in Git/cmd/ or Git/bin/ — go up two levels to Git root, then into bin/
  const bashPath = join(gitPath, '..', '..', 'bin', 'bash.exe');
  try {
    if (statSync(bashPath).isFile()) return bashPath;
  } catch {
    // Fall through
  }

  return undefined;
}

/**
 * Detect available shells on Windows in priority order.
 * Priority: pwsh → powershell → git bash → cmd
 */
function detectWindowsShells(): ShellInfo[] {
  const shells: ShellInfo[] = [];

  const pwsh = which('pwsh');
  if (pwsh) shells.push({ path: pwsh, name: 'pwsh' });

  const powershell = which('powershell');
  if (powershell) shells.push({ path: powershell, name: 'powershell' });

  const gitBash = findGitBash();
  if (gitBash) shells.push({ path: gitBash, name: 'bash' });

  const comspec = process.env.COMSPEC || 'cmd.exe';
  shells.push({ path: comspec, name: 'cmd' });

  return shells;
}

/**
 * Detect the best available shell for the current platform.
 *
 * Unix: uses $SHELL env var, falls back to /bin/zsh (macOS) or /bin/bash or /bin/sh.
 * Windows: pwsh → powershell → git bash → cmd (via COMSPEC).
 */
export function detectShell(): ShellInfo {
  if (process.platform !== 'win32') {
    const envShell = process.env.SHELL;
    if (envShell) {
      return { path: envShell, name: basename(envShell) };
    }
    if (process.platform === 'darwin') {
      return { path: '/bin/zsh', name: 'zsh' };
    }
    const bash = which('bash');
    if (bash) return { path: bash, name: 'bash' };
    return { path: '/bin/sh', name: 'sh' };
  }

  const windowsShells = detectWindowsShells();
  return windowsShells[0] ?? { path: 'cmd.exe', name: 'cmd' };
}

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

  /** Detected shell information (only available in host mode) */
  readonly shell?: ShellInfo;

  /** Maximum output size in bytes */
  readonly maxOutputSize: number;

  /** Resolve a relative path within workspace and verify it stays within bounds */
  resolvePath(filePath: string): string;

  /** Execute a shell command */
  exec(command: string, options?: { timeout?: number }): Promise<ExecResult>;

  /**
   * Execute a command with argv array form (no shell).
   *
   * Each argument is passed to the executable verbatim — shell metacharacters
   * ($(), ``, ;, |) are treated as literal characters and cannot trigger
   * command injection. This is the safe way to run a command whose arguments
   * contain untrusted content.
   */
  execArray(exe: string, args: string[], options?: { timeout?: number }): Promise<ExecResult>;

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
  grep(
    pattern: string,
    path: string,
    options?: { cwd?: string; include?: string }
  ): Promise<string>;

  /** Check if file exists and is a regular file. Throws on permission errors (EACCES). */
  statFile(filePath: string): Promise<{ exists: boolean; isFile: boolean }>;

  /** Detect binary file by examining content */
  isBinaryFile(filePath: string): Promise<boolean>;
}

/**
 * Host-based implementation of ToolDeps using Node.js native APIs.
 * All operations run directly on the host system.
 */
export class HostToolDeps implements ToolDeps {
  readonly workspaceRoot: string;
  readonly maxOutputSize: number;
  readonly shell: ShellInfo;
  private readonly defaultTimeout: number;

  constructor(
    workspaceRoot: string,
    maxOutputSize: number = DEFAULT_MAX_TOOL_OUTPUT,
    shell?: ShellInfo,
    defaultTimeout: number = 600_000
  ) {
    this.workspaceRoot = workspaceRoot;
    this.maxOutputSize = maxOutputSize;
    this.shell = shell ?? detectShell();
    this.defaultTimeout = defaultTimeout;
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
    const timeout = options?.timeout ?? this.defaultTimeout;
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: this.maxOutputSize,
        shell: this.shell.path,
        cwd: this.workspaceRoot,
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

  /**
   * Execute a command using execFile (no shell), passing args as an array.
   *
   * Unlike {@link exec}, this does NOT go through a shell, so each argument is
   * passed to the executable verbatim. This is the safe way to run a command
   * whose arguments contain untrusted content (e.g. a regex pattern from the
   * LLM) — shell metacharacters ($(), ``, ;, etc.) are treated as literal
   * characters and cannot trigger command injection.
   */
  async execArray(
    exe: string,
    args: string[],
    options?: { timeout?: number }
  ): Promise<ExecResult> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    try {
      const { stdout, stderr } = await execFileAsync(exe, args, {
        timeout,
        maxBuffer: this.maxOutputSize,
        cwd: this.workspaceRoot,
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
    return await fs.readFile(absolute, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const absolute = this.resolvePath(filePath);
    const directory = resolve(absolute, '..');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(absolute, content, 'utf-8');
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

  async grep(
    pattern: string,
    path: string,
    options?: { cwd?: string; include?: string }
  ): Promise<string> {
    const cwd = options?.cwd ?? this.workspaceRoot;
    const searchPath = resolve(cwd, path);
    // Pass pattern and glob as literal args via execFile (no shell).
    // This is critical: `pattern` is an untrusted regex from the LLM and may
    // contain shell metacharacters ($(), ``, ;). Using execArray ensures they
    // are treated as literal characters, not shell syntax (SEC1).
    const args = [pattern, searchPath, '--no-heading', '--line-number'];

    if (options?.include) {
      // No shell quoting needed — execFile passes the glob verbatim to rg.
      args.push('--glob', options.include);
    }

    try {
      const result = await this.execArray(rgPath, args);
      return result.stdout || 'No matches found';
    } catch {
      return 'No matches found';
    }
  }

  async statFile(filePath: string): Promise<{ exists: boolean; isFile: boolean }> {
    const absolute = this.resolvePath(filePath);
    try {
      const s = await fs.stat(absolute);
      return { exists: true, isFile: s.isFile() };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES') {
        throw new Error(`Permission denied: ${filePath}`);
      }
      if (code === 'ENOENT') {
        return { exists: false, isFile: false };
      }
      throw new Error(`Failed to access file: ${filePath} (${(error as Error).message})`);
    }
  }

  async isBinaryFile(filePath: string): Promise<boolean> {
    // Sandbox-internal paths (/...) are unreachable from the host filesystem,
    // so inspect the content inside the sandbox: compare the raw byte count
    // with the null-byte-stripped count (mirrors the Rust SandboxToolDeps).
    //
    // TODO(binary-detection): NUL-presence is a deliberate, documented
    // divergence from the Rust side, which uses binaryornot-rs's trained
    // decision-tree classifier (signatures + byte statistics). The plan is to
    // lift THIS side up to the classifier (WASM wrapper of binaryornot-rs),
    // not to drag Rust down to the NUL check — see the Rust workspace_deps.rs
    // doc comment for the full rationale.
    const absolute = this.resolvePath(filePath);
    const q = shellSingleQuote(absolute);
    const [raw, stripped] = await Promise.all([
      this.exec(`wc -c < ${q}`),
      this.exec(`tr -d '\\000' < ${q} | wc -c`),
    ]);
    if (raw.exitCode !== 0 || stripped.exitCode !== 0) {
      return false;
    }
    const rawN = Number.parseInt(raw.stdout.trim(), 10);
    const strippedN = Number.parseInt(stripped.stdout.trim(), 10);
    return Number.isFinite(rawN) && Number.isFinite(strippedN) && rawN !== strippedN;
  }
}

// ─── SandboxToolDeps ───

/**
 * Sandbox-based implementation of ToolDeps.
 * ALL operations go through sandbox.run() with sandbox-internal paths (/workspace).
 * No host-side filesystem access — this is the core sandbox isolation principle.
 *
 * writeFile uses stdin piping: content is piped to `cat > file` via sandbox stdin.
 * editFile uses read-modify-write: read via cat, replace in JS, write back via stdin.
 */
export class SandboxToolDeps implements ToolDeps {
  readonly workspaceRoot = '/';
  readonly maxOutputSize: number;

  private readonly sandbox: Sandbox;
  private readonly defaultTimeout: number;

  constructor(
    sandbox: Sandbox,
    maxOutputSize: number = DEFAULT_MAX_TOOL_OUTPUT,
    defaultTimeout: number = 600_000
  ) {
    this.sandbox = sandbox;
    this.maxOutputSize = maxOutputSize;
    this.defaultTimeout = defaultTimeout;
  }

  resolvePath(filePath: string): string {
    // Sandbox-internal paths are relative to `/`; node's resolve() already
    // joins + lexically normalizes (`/a/../b` → `/b`). No traversal check
    // here — the wasmtime capability layer is the real boundary.
    return resolve('/', filePath);
  }

  async exec(command: string, _options?: { timeout?: number }): Promise<ExecResult> {
    const result = await this.sandbox.run(command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async execArray(
    exe: string,
    args: string[],
    _options?: { timeout?: number }
  ): Promise<ExecResult> {
    // The sandbox API only accepts a command string (sandbox.run), so we cannot
    // bypass the shell entirely. Instead, each argv element is shell-quoted via
    // shell-quote's quote() and joined — metacharacters become literal. This
    // prevents command injection while preserving correct argument boundaries.
    const cmd = quote([exe, ...args]);
    const result = await this.sandbox.run(cmd);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async readFile(filePath: string): Promise<string> {
    const absolute = this.resolvePath(filePath);
    // SEC5: use execArray (no shell) so the path is a literal argv element
    const result = await this.execArray('cat', [absolute]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read ${filePath}: ${result.stdout}`);
    }
    return result.stdout;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const absolute = this.resolvePath(filePath);
    // Ensure parent directory exists via sandbox (mkdir -p fixed for WASI)
    const dir = dirname(absolute);
    // SEC5: use execArray (no shell) for mkdir
    await this.execArray('mkdir', ['-p', dir]);
    // Write file by piping content through stdin to cat.
    // SEC5: cat > uses shell redirect, so the path MUST be single-quoted.
    const writeResult = await this.sandbox.run(`cat > ${shellSingleQuote(absolute)}`, {
      stdin: content,
    });
    if (writeResult.exitCode !== 0) {
      throw new Error(`Failed to write ${filePath}: ${writeResult.stdout}`);
    }
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

    const escaped = oldString.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const count = (content.match(new RegExp(escaped, 'g')) ?? []).length;

    if (count > 1 && !replaceAll) {
      return `Error: Found ${count} matches in ${filePath}. Set replaceAll to true to replace all.`;
    }

    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    await this.writeFile(filePath, newContent);
    return `Successfully replaced ${replaceAll ? count : 1} occurrence${count === 1 ? '' : 's'}`;
  }

  async glob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
    const cwd = options?.cwd ? this.resolvePath(options.cwd) : '/';
    // find is not available in busybox-wasi; use ls -R instead
    // SEC5: use execArray (no shell) so cwd path is a literal argv element
    const result = await this.execArray('ls', ['-R', cwd]);
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return [];
    }

    // Parse ls -R output: directories end with ":", files are plain lines
    const allFiles = parseLsRecursive(result.stdout, cwd);
    const regex = globToRegex(pattern);
    return allFiles.filter((f) => regex.test(f));
  }

  async grep(
    pattern: string,
    path: string,
    options?: { cwd?: string; include?: string }
  ): Promise<string> {
    const searchPath = this.resolvePath(path);
    // pattern and include are untrusted (LLM-supplied). wsh expands $() and
    // backticks inside double quotes, so they MUST be POSIX single-quoted to
    // be treated as literal grep arguments (SEC2).
    let cmd = `grep -rn ${shellSingleQuote(pattern)} ${shellSingleQuote(searchPath)}`;
    if (options?.include) {
      cmd += ` --include=${shellSingleQuote(options.include)}`;
    }
    const result = await this.sandbox.run(cmd);
    if (result.exitCode !== 0) {
      return 'No matches found';
    }
    return result.stdout;
  }

  async statFile(filePath: string): Promise<{ exists: boolean; isFile: boolean }> {
    const absolute = this.resolvePath(filePath);
    // Use separate test -f and test -d calls for reliable detection across
    // different sandbox environments (WASM busybox may not support chained
    // test -e with subshells consistently).
    // SEC5: test uses && / || (shell syntax), so the path MUST be single-quoted
    const fileResult = await this.sandbox.run(
      `test -f ${shellSingleQuote(absolute)} && echo YES || echo NO`
    );
    if (fileResult.stdout.trim() === 'YES') return { exists: true, isFile: true };
    const dirResult = await this.sandbox.run(
      `test -d ${shellSingleQuote(absolute)} && echo YES || echo NO`
    );
    if (dirResult.stdout.trim() === 'YES') return { exists: true, isFile: false };
    return { exists: false, isFile: false };
  }

  async isBinaryFile(filePath: string): Promise<boolean> {
    const absolute = this.resolvePath(filePath);
    // Detect null bytes by comparing file size before/after removing null bytes.
    // Uses tr -d "\000" to strip null bytes and wc -c to count.
    // This avoids relying on od | grep piping which behaves inconsistently
    // in busybox/WASM environments (e.g. "(standard input):" prefix, non-zero exit).
    // SEC5: wc and tr use shell redirects (<) and pipes (|), so the path
    // MUST be single-quoted to prevent injection.
    const quoted = shellSingleQuote(absolute);
    const sizeResult = await this.sandbox.run(`wc -c < ${quoted}`);
    if (sizeResult.exitCode !== 0) return false;
    const originalSize = parseInt(sizeResult.stdout.trim(), 10);
    if (isNaN(originalSize) || originalSize === 0) return false;
    const strippedResult = await this.sandbox.run(`tr -d "\\000" < ${quoted} | wc -c`);
    if (strippedResult.exitCode !== 0) return false;
    const strippedSize = parseInt(strippedResult.stdout.trim(), 10);
    // If sizes differ, null bytes were removed → binary file
    return !isNaN(strippedSize) && strippedSize < originalSize;
  }
}

/** Parse `ls -R` output into a flat list of relative file paths */
function parseLsRecursive(output: string, root: string): string[] {
  const prefix = root.endsWith('/') ? root : root + '/';
  const files: string[] = [];
  let currentDir = '';

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('total')) continue;

    if (trimmed.endsWith(':')) {
      // Directory header line: "/workspace/src:"
      currentDir = trimmed.slice(0, -1);
      continue;
    }

    // File entry — prepend current directory
    const fullPath = currentDir ? `${currentDir}/${trimmed}` : trimmed;
    const relative = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
    if (relative) files.push(relative);
  }

  return files;
}

/** Convert a simple glob pattern to a RegExp */
function globToRegex(pattern: string): RegExp {
  const chars = pattern.split('');
  const parts: string[] = ['^'];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === '*' && chars[i + 1] === '*') {
      parts.push('.*');
      i += 2;
      if (chars[i] === '/') i++; // skip trailing /
    } else if (c === '*') {
      parts.push('[^/]*');
      i++;
    } else if (c === '?') {
      parts.push('[^/]');
      i++;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      parts.push('\\' + c);
      i++;
    } else {
      parts.push(c);
      i++;
    }
  }
  parts.push('$');
  return new RegExp(parts.join(''));
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
  const limit = maxSize ?? DEFAULT_MAX_TOOL_OUTPUT;
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
  // TODO(binary-detection): `isbinaryfile`'s NUL-presence rule is a
  // deliberate, documented divergence from the Rust side (binaryornot-rs
  // decision-tree classifier). Plan: lift this side UP to the classifier
  // (WASM wrapper), not drag Rust down — see the Rust workspace_deps.rs
  // doc comment for the full rationale.
  try {
    return await detectBinary(filePath);
  } catch {
    return false;
  }
}
