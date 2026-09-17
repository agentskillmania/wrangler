/**
 * @fileoverview 宿主启动自举（R2P-201，镜像 Rust wrangler::bootstrap）。
 *
 * Node 宿主（daemon）启动时调用一次：把 colts 的 Node SkillFsOps 实现注册
 * 到全局缺省槽，使任何 FilesystemSkillProvider（会话装配、skills 查询端
 * 点）不经 colts 直接 import node: 模块。幂等——宿主重复调用无害。
 */

import { setDefaultSkillFsOps } from '@agentskillmania/colts';
import { nodeFsOps } from '@agentskillmania/colts/skills/node-fs-ops';

/**
 * 注册 Node SkillFsOps 实现（幂等）。
 *
 * daemon 生产代码不直接 import colts（R2P-201 边界执法）——Node 侧 fs
 * 绑定经本门面完成，对齐 Rust c410f79 把宿主自检收进 wrangler::bootstrap
 * 的做法。
 */
export function ensureNodeSkillFsOps(): void {
  setDefaultSkillFsOps(nodeFsOps);
}
