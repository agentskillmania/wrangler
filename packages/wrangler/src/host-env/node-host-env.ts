/**
 * @fileoverview NodeHostEnv — HostEnv 的 Node.js 实现。
 *
 * daemon / CLI 用。6 个子实现都是 thin wrapper，直接映射 node 内置模块，
 * 行为与改造前的代码完全等价。
 */

import { Buffer } from 'node:buffer';
import { exec, execFile, execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import * as nodePath from 'node:path';
import { promisify } from 'node:util';

import fglob from 'fast-glob';
import { isBinaryFile as detectBinary } from 'isbinaryfile';
import { rgPath } from 'ripgrep';

import type {
  DirEntry,
  ExecResult,
  HostEnv,
  HostEnvCrypto,
  HostEnvEnv,
  HostEnvExecOptions,
  HostEnvFs,
  HostEnvPath,
  HostEnvProcess,
  HostEnvResources,
  RuntimeStat,
  ShellInfo,
} from './types.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const nodeRequire = typeof require === 'function' ? require : createRequire(import.meta.url);

// ─── shell 检测（从 workspace-deps.ts 搬来，第 3-c 批移除原文件重复）───

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

function findGitBash(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  const envOverride = process.env.WRANGLER_GIT_BASH_PATH;
  if (envOverride) return envOverride;
  const gitPath = which('git');
  if (!gitPath) return undefined;
  const bashPath = nodePath.join(gitPath, '..', '..', 'bin', 'bash.exe');
  try {
    if (statSync(bashPath).isFile()) return bashPath;
  } catch {
    // Fall through
  }
  return undefined;
}

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
 * Detect the best available shell for the current platform (Node-only
 * convenience; moved from workspace-deps.ts). Browser code should use
 * `runtime.env.detectShell()` instead.
 */
export function detectShell(): ShellInfo {
  if (process.platform !== 'win32') {
    const envShell = process.env.SHELL;
    if (envShell) return { path: envShell, name: nodePath.basename(envShell) };
    if (process.platform === 'darwin') return { path: '/bin/zsh', name: 'zsh' };
    const bash = which('bash');
    if (bash) return { path: bash, name: 'bash' };
    return { path: '/bin/sh', name: 'sh' };
  }
  const windowsShells = detectWindowsShells();
  return windowsShells[0] ?? { path: 'cmd.exe', name: 'cmd' };
}

// ─── NodeHostEnvFs ───────────────────────────────────────────────────

class NodeHostEnvFs implements HostEnvFs {
  async readFile(path: string): Promise<string> {
    return fs.readFile(path, 'utf-8');
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return fs.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fs.writeFile(path, content, 'utf-8');
  }

  async writeFileBytes(path: string, content: Uint8Array): Promise<void> {
    await fs.writeFile(path, content);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, options);
  }

  async rm(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.rm(path, options);
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
    }));
  }

  async stat(path: string): Promise<RuntimeStat> {
    try {
      const s = await fs.stat(path);
      return {
        exists: true,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        size: s.size,
        mtime: s.mtimeMs,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { exists: false, isFile: false, isDirectory: false, size: 0, mtime: 0 };
      }
      // EACCES 和其他错误都抛（与原版 HostToolDeps.statFile 行为一致）
      if (code === 'EACCES') throw new Error(`Permission denied: ${path}`);
      throw new Error(`Failed to access: ${path} (${(error as Error).message})`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async editFile(
    path: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean
  ): Promise<string> {
    let content = await fs.readFile(path, 'utf-8');
    if (replaceAll) {
      content = content.split(oldString).join(newString);
    } else {
      const idx = content.indexOf(oldString);
      if (idx === -1) {
        throw new Error(`editFile: oldString not found in ${path}`);
      }
      content = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
    }
    await fs.writeFile(path, content, 'utf-8');
    return content;
  }

  async glob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
    return fglob(pattern, { cwd: options?.cwd, onlyFiles: true });
  }

  async grep(
    pattern: string,
    path: string,
    options?: { cwd?: string; include?: string }
  ): Promise<string> {
    // 用 ripgrep（与原版 HostToolDeps.grep 完全一致的调用逻辑）
    const cwd = options?.cwd ?? path;
    const searchPath = nodePath.resolve(cwd, path);
    const args = [pattern, searchPath, '--no-heading', '--line-number'];
    if (options?.include) {
      args.push('--glob', options.include);
    }
    try {
      const { stdout } = await execFileAsync(rgPath, args, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout || 'No matches found';
    } catch {
      return 'No matches found';
    }
  }

  async isBinary(path: string): Promise<boolean> {
    return detectBinary(path).catch(() => false);
  }
}

// ─── NodeHostEnvProcess ──────────────────────────────────────────────

class NodeHostEnvProcess implements HostEnvProcess {
  async exec(command: string, options?: HostEnvExecOptions): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        encoding: 'utf-8',
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
        shell: options?.shell,
        cwd: options?.cwd,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
        exitCode: e.code ?? 1,
      };
    }
  }

  async execArray(exe: string, args: string[], options?: HostEnvExecOptions): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync(exe, args, {
        encoding: 'utf-8',
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
        cwd: options?.cwd,
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
        exitCode: e.code ?? 1,
      };
    }
  }

  byteLength(s: string): number {
    return Buffer.byteLength(s);
  }
}

// ─── NodeHostEnvPath ─────────────────────────────────────────────────

class NodeHostEnvPath implements HostEnvPath {
  readonly sep = nodePath.sep;
  join = nodePath.join;
  resolve = nodePath.resolve;
  dirname = nodePath.dirname;
  basename = nodePath.basename;
  extname = nodePath.extname;
  normalize = nodePath.normalize;
  isAbsolute = nodePath.isAbsolute;
}

// ─── NodeHostEnvCrypto ───────────────────────────────────────────────

class NodeHostEnvCrypto implements HostEnvCrypto {
  uuid(): string {
    // globalThis.crypto.randomUUID 在 Node ≥19 也可用，但这里保持 node:crypto
    // 显式调用以匹配现有行为（Node 侧 100% 等价）
    return randomUUID();
  }

  hash(input: string): string {
    // 保持现有 md5 行为（SessionStore 的 workspaceHash 兼容性）
    return createHash('md5').update(input).digest('hex');
  }
}

// ─── NodeHostEnvEnv ──────────────────────────────────────────────────

class NodeHostEnvEnv implements HostEnvEnv {
  readonly platform = process.platform as 'win32' | 'darwin' | 'linux';

  get vars(): Readonly<Record<string, string>> {
    return process.env as Record<string, string>;
  }

  appDataDir(): string {
    const env = process.env.AGENTSKILLMANIA_APP_DIR;
    if (env && env.trim()) return env;
    return nodePath.join(homedir(), '.agentskillmania', 'skill-studio');
  }

  cwd(): string {
    return process.cwd();
  }

  detectShell(): ShellInfo {
    return detectShell();
  }
}

// ─── NodeHostEnvResources ────────────────────────────────────────────

class NodeHostEnvResources implements HostEnvResources {
  private skillDocCache = new Map<string, string>();

  async loadSkillDoc(name: string): Promise<string> {
    const cached = this.skillDocCache.get(name);
    if (cached !== undefined) return cached;
    // 定位 wrangler 包内的 spec-plan/skills/{name}/SKILL.md
    const wranglerPkg = this.resolvePackagePath('@agentskillmania/wrangler');
    if (!wranglerPkg)
      throw new Error(`Cannot resolve @agentskillmania/wrangler to load skill doc '${name}'`);
    const skillPath = nodePath.join(wranglerPkg, 'dist', 'spec-plan', 'skills', name, 'SKILL.md');
    const content = await fs.readFile(skillPath, 'utf-8');
    this.skillDocCache.set(name, content);
    return content;
  }

  resolvePackagePath(pkg: string): string | null {
    try {
      const pkgJsonPath = nodeRequire.resolve(`${pkg}/package.json`);
      return nodePath.dirname(pkgJsonPath);
    } catch {
      return null;
    }
  }

  builtinSkillDirs(): string[] {
    const wranglerPkg = this.resolvePackagePath('@agentskillmania/wrangler');
    if (!wranglerPkg) return [];
    return [nodePath.join(wranglerPkg, 'dist', 'spec-plan', 'skills')];
  }
}

// ─── NodeHostEnv ─────────────────────────────────────────────────────

/**
 * NodeHostEnv — HostEnv 的 Node.js 实现。
 *
 * daemon / CLI 用。所有子实现都是 node 内置模块的 thin wrapper，
 * 行为与改造前代码完全等价。
 */
export class NodeHostEnv implements HostEnv {
  readonly fs: HostEnvFs = new NodeHostEnvFs();
  readonly process: HostEnvProcess = new NodeHostEnvProcess();
  readonly path: HostEnvPath = new NodeHostEnvPath();
  readonly crypto: HostEnvCrypto = new NodeHostEnvCrypto();
  readonly env: HostEnvEnv = new NodeHostEnvEnv();
  readonly resources: HostEnvResources = new NodeHostEnvResources();
}

/** 默认 NodeHostEnv 单例（给 Loader 等未显式传 runtime 的场景兜底用） */
export const defaultNodeHostEnv = new NodeHostEnv();

/**
 * Detect binary files (Node-only convenience, moved from workspace-deps).
 * Browser code should use `runtime.fs.isBinary` instead.
 */
export async function isBinaryFile(filePath: string, runtime?: HostEnv): Promise<boolean> {
  if (runtime) return runtime.fs.isBinary(filePath);
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
