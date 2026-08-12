import type { Sandbox } from '@agentskillmania/sandbox';
import { quote } from 'shell-quote';

import type { HostEnv } from '../../host-env/index.js';

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
 * 极简 POSIX 路径拼接 + 规范化（替代 path.resolve 的浏览器场景）。
 * 以 '/' 开头的部分会重置累积结果（与 path.resolve 语义一致）。
 */
function simpleResolve(...parts: string[]): string {
  let joined = '/';
  for (const part of parts) {
    if (!part) continue;
    joined = part.startsWith('/') ? part : `${joined === '/' ? '' : joined}/${part}`;
  }
  const segments: string[] = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segments.pop();
      continue;
    }
    segments.push(seg);
  }
  return '/' + segments.join('/');
}

/** 极简 POSIX dirname（替代 path.dirname 的浏览器场景） */
function simpleDirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx <= 0 ? '/' : p.slice(0, idx);
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
    private readonly runtime: HostEnv,
    workspaceRoot: string,
    maxOutputSize: number = DEFAULT_MAX_TOOL_OUTPUT,
    shell?: ShellInfo,
    defaultTimeout: number = 600_000
  ) {
    this.workspaceRoot = workspaceRoot;
    this.maxOutputSize = maxOutputSize;
    this.shell = shell ?? runtime.env.detectShell() ?? { path: '/bin/sh', name: 'sh' };
    this.defaultTimeout = defaultTimeout;
  }

  resolvePath(filePath: string): string {
    const absolute = this.runtime.path.resolve(this.workspaceRoot, filePath);
    const prefix = this.workspaceRoot + this.runtime.path.sep;
    if (absolute !== this.workspaceRoot && !absolute.startsWith(prefix)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    return absolute;
  }

  async exec(command: string, options?: { timeout?: number }): Promise<ExecResult> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    return this.runtime.process.exec(command, {
      timeout,
      maxBuffer: this.maxOutputSize,
      shell: this.shell.path,
      cwd: this.workspaceRoot,
    });
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
    return this.runtime.process.execArray(exe, args, {
      timeout,
      maxBuffer: this.maxOutputSize,
      cwd: this.workspaceRoot,
    });
  }

  async readFile(filePath: string): Promise<string> {
    return await this.runtime.fs.readFile(this.resolvePath(filePath));
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const absolute = this.resolvePath(filePath);
    await this.runtime.fs.mkdir(this.runtime.path.dirname(absolute), { recursive: true });
    await this.runtime.fs.writeFile(absolute, content);
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
    const files = await this.runtime.fs.glob(pattern, { cwd });
    // runtime.fs.glob returns paths relative to cwd; resolve to absolute to
    // preserve the historical contract (e.g. createGlobTool slices results
    // against workspaceRoot and expects them to start with it).
    return files.map((f) =>
      this.runtime.path.isAbsolute(f) ? f : this.runtime.path.resolve(cwd, f)
    );
  }

  async grep(
    pattern: string,
    path: string,
    options?: { cwd?: string; include?: string }
  ): Promise<string> {
    return this.runtime.fs.grep(pattern, path, {
      cwd: options?.cwd ?? this.workspaceRoot,
      include: options?.include,
    });
  }

  async statFile(filePath: string): Promise<{ exists: boolean; isFile: boolean }> {
    const stat = await this.runtime.fs.stat(this.resolvePath(filePath));
    return { exists: stat.exists, isFile: stat.isFile };
  }

  async isBinaryFile(filePath: string): Promise<boolean> {
    // Guard the missing-file case: runtime.fs.isBinary maps read failures to
    // `true`, but the historical contract (and the host-env isBinaryFile
    // helper) treat an unreadable/missing file as "not binary" (false).
    const absolute = this.resolvePath(filePath);
    const stat = await this.runtime.fs.stat(absolute);
    if (!stat.exists) return false;
    return this.runtime.fs.isBinary(absolute);
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

  constructor(
    sandbox: Sandbox,
    maxOutputSize: number = DEFAULT_MAX_TOOL_OUTPUT,
    _defaultTimeout: number = 600_000
  ) {
    this.sandbox = sandbox;
    this.maxOutputSize = maxOutputSize;
  }

  resolvePath(filePath: string): string {
    // Sandbox-internal paths are relative to `/`; simpleResolve() joins +
    // lexically normalizes (`/a/../b` → `/b`). No traversal check here —
    // the wasmtime capability layer is the real boundary.
    return simpleResolve('/', filePath);
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
    const dir = simpleDirname(absolute);
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
  const absolute = simpleResolve(deps.workspacePath, filePath);
  const prefix = deps.workspacePath.endsWith('/') ? deps.workspacePath : deps.workspacePath + '/';
  if (absolute !== deps.workspacePath && !absolute.startsWith(prefix)) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
  return absolute;
}

/** Truncate output to max byte size with UTF-8 safe boundary */
export function truncateOutput(
  output: string,
  maxSize?: number,
  runtime?: HostEnv
): { content: string; truncated: boolean } {
  const limit = maxSize ?? DEFAULT_MAX_TOOL_OUTPUT;
  const marker = '\n...[truncated]';
  const byteLenFn = runtime
    ? (s: string) => runtime.process.byteLength(s)
    : (s: string) => new TextEncoder().encode(s).length;
  const byteLen = byteLenFn(output);
  if (byteLen <= limit) return { content: output, truncated: false };

  // Shrink from end until byte length fits (including marker)
  let end = output.length;
  while (end > 0 && byteLenFn(output.slice(0, end) + marker) > limit) {
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
