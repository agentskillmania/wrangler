/**
 * @fileoverview HostEnv — 宿主环境抽象层
 *
 * 引擎核心通过 HostEnv 访问一切 OS 资源。
 * 详见 docs/HOST-ENV-DESIGN.md（在 agentic-chrome-addon 仓库）。
 */

export type {
  ShellInfo,
  ExecResult,
  DirEntry,
  RuntimeStat,
  GrepResult,
  HostEnv,
  HostEnvFs,
  HostEnvProcess,
  HostEnvPath,
  HostEnvCrypto,
  HostEnvEnv,
  HostEnvResources,
} from './types.js';

export { RuntimeCapabilityError } from './types.js';
export { NodeHostEnv, defaultNodeHostEnv } from './node-host-env.js';
