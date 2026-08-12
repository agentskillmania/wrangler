// packages/core/src/session/meta.ts

import yaml from 'js-yaml';

import type { HostEnv } from '../host-env/index.js';
import type { SessionMeta } from '../types.js';

/**
 * 将 SessionMeta 写入 meta.yaml
 *
 * @param sessionDir - session 目录路径
 * @param meta - session 元数据
 * @param runtime - 宿主环境（提供 fs/path）
 */
export async function writeMeta(
  sessionDir: string,
  meta: SessionMeta,
  runtime: HostEnv,
): Promise<void> {
  const content = yaml.dump(meta);
  await runtime.fs.writeFile(runtime.path.join(sessionDir, 'meta.yaml'), content);
}

/**
 * 从 meta.yaml 读取 SessionMeta
 *
 * @param sessionDir - session 目录路径
 * @param runtime - 宿主环境（提供 fs/path）
 * @returns SessionMeta 或 null（文件不存在时）
 */
export async function readMeta(
  sessionDir: string,
  runtime: HostEnv,
): Promise<SessionMeta | null> {
  try {
    const content = await runtime.fs.readFile(runtime.path.join(sessionDir, 'meta.yaml'));
    return yaml.load(content) as SessionMeta;
  } catch {
    return null;
  }
}
