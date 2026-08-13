/**
 * @fileoverview HostEnv — wrangler/colts 与宿主环境之间的唯一边界。
 *
 * 引擎核心通过 HostEnv 访问一切 OS 资源（文件系统、进程、路径、加密、环境信息），
 * 不直接 import node:fs / node:os / node:crypto / process。
 *
 * 两个参考实现：
 * - NodeHostEnv：daemon / CLI 用，直接映射 node:fs / child_process / os
 * - BrowserHostEnv：Chrome 扩展用，fs 走 OPFS + FS Access API，exec 抛错
 *
 * 设计原则：HostEnv 是纯粹的"OS 能力提供者"，不声明自己有什么/缺什么能力。
 * 工具过滤（如浏览器禁用 shell/git/python）由调用方通过结构化的 BuiltinToolFilter
 * 显式配置，不走 HostEnv 的能力声明。
 */

// ─── 基础类型（从现有代码收敛，保持兼容） ────────────────────────────

/** shell 信息（与 workspace-deps.ts 的 ShellInfo 兼容） */
export interface ShellInfo {
  path: string;
  name: string;
}

/** 命令执行结果（与 workspace-deps.ts 的 ExecResult 兼容） */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** 目录条目 */
export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

/** 文件 stat 信息 */
export interface RuntimeStat {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

/** grep 匹配结果 */
export interface GrepResult {
  file: string;
  line: number;
  column: number;
  match: string;
  /** 匹配行内容 */
  context?: string;
}

// ─── 异常 ────────────────────────────────────────────────────────────

/** 宿主环境不支持某能力时抛出（如浏览器调 exec） */
export class RuntimeCapabilityError extends Error {
  constructor(
    readonly capability: string,
    message: string
  ) {
    super(`Capability '${capability}' unavailable: ${message}`);
    this.name = 'RuntimeCapabilityError';
  }
}

// ─── 6 个能力面接口 ──────────────────────────────────────────────────

/**
 * 文件系统抽象。
 * 强制异步 API——阻止 ESM 顶层 readFileSync 这类问题再出现。
 */
export interface HostEnvFs {
  readFile(path: string): Promise<string>;
  readFileBytes(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string): Promise<void>;
  writeFileBytes(path: string, content: Uint8Array): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  readdir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<RuntimeStat>;
  exists(path: string): Promise<boolean>;

  /**
   * 编辑文件：替换 oldString 为 newString。
   * replaceAll=true 时替换全部匹配。返回编辑后的文件内容。
   */
  editFile(
    path: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean
  ): Promise<string>;

  /** glob 模式匹配文件列表 */
  glob(pattern: string, options?: { cwd?: string }): Promise<string[]>;

  /** 正则搜索文件内容。Node 用 ripgrep，浏览器用纯 JS。返回 grep 格式的原始输出字符串 */
  grep(
    pattern: string,
    path: string,
    options?: { cwd?: string; include?: string }
  ): Promise<string>;

  /** 二进制文件检测 */
  isBinary(path: string): Promise<boolean>;
}

/** 进程执行（浏览器抛 RuntimeCapabilityError） */
export interface HostEnvProcess {
  exec(command: string, options?: HostEnvExecOptions): Promise<ExecResult>;
  execArray(exe: string, args: string[], options?: HostEnvExecOptions): Promise<ExecResult>;

  /** 字节长度计算（替代 Buffer.byteLength，truncateOutput 用） */
  byteLength(s: string): number;
}

/** 进程执行选项（覆盖 shell/cwd/timeout/maxBuffer 等通用配置） */
export interface HostEnvExecOptions {
  /** 超时（毫秒） */
  timeout?: number;
  /** 工作目录 */
  cwd?: string;
  /** shell 可执行文件路径（如 /bin/bash）；不传则用系统默认 shell */
  shell?: string;
  /** stdout/stderr 最大字节数 */
  maxBuffer?: number;
}

/** 路径操作（浏览器用 path-browserify 或纯 JS 实现） */
export interface HostEnvPath {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  extname(path: string): string;
  normalize(path: string): string;
  isAbsolute(path: string): boolean;
  readonly sep: string;
}

/** 加密与 ID */
export interface HostEnvCrypto {
  /** 生成 UUID（替代 node:crypto.randomUUID） */
  uuid(): string;

  /**
   * 字符串哈希（替代 createHash('md5')，用于 workspace 路径分组目录名）。
   * 非安全用途，纯映射。返回十六进制字符串。
   * 浏览器用同步纯 JS 实现（避免 SubtleCrypto 异步连锁修改）。
   */
  hash(input: string): string;
}

/** 环境信息 */
export interface HostEnvEnv {
  /** 平台标识 */
  readonly platform: 'win32' | 'darwin' | 'linux' | 'browser';

  /**
   * 环境变量（只读视图）。浏览器返回扩展配置。
   */
  readonly vars: Readonly<Record<string, string>>;

  /**
   * 应用数据根目录（替代 appDir() 的 homedir + process.env.AGENTSKILLMANIA_APP_DIR）。
   */
  appDataDir(): string;

  /** 当前工作目录（替代 process.cwd()）。浏览器返回虚拟 workspace 根 */
  cwd(): string;

  /** 检测可用 shell（替代 detectShell）。浏览器返回 null */
  detectShell(): ShellInfo | null;
}

/** 资源加载（覆盖模块顶层 readFileSync + createRequire.resolve） */
export interface HostEnvResources {
  /**
   * 加载内置技能文档（替代 6 处顶层 readFileSync）。
   * 例：loadSkillDoc('conceive') → conceive/SKILL.md 内容。
   */
  loadSkillDoc(name: string): Promise<string>;

  /**
   * 解析已安装 npm 包的根目录路径（替代 createRequire.resolve）。
   * 浏览器返回 null（打包后无 node_modules 结构）。
   */
  resolvePackagePath(pkg: string): string | null;

  /** 获取内置技能目录列表（替代 collectSkillDirs 里的 nodeRequire.resolve 逻辑） */
  builtinSkillDirs(): string[];
}

// ─── 主接口 ──────────────────────────────────────────────────────────

/**
 * HostEnv — wrangler/colts 与宿主环境之间的唯一边界。
 */
export interface HostEnv {
  readonly fs: HostEnvFs;
  readonly process: HostEnvProcess;
  readonly path: HostEnvPath;
  readonly crypto: HostEnvCrypto;
  readonly env: HostEnvEnv;
  readonly resources: HostEnvResources;
}
