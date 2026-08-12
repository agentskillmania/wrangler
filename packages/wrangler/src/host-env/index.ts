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
// 注意：不 re-export NodeHostEnv/defaultNodeHostEnv——它们是 Node 实现，
// 由组合根从 ./node-host-env.js 子路径 import（避免浏览器打包拖入 node: 依赖）。
