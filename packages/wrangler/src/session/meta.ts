// packages/core/src/session/meta.ts

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { SessionMeta } from '../types.js';

/**
 * 将 SessionMeta 写入 meta.yaml
 *
 * @param sessionDir - session 目录路径
 * @param meta - session 元数据
 */
export async function writeMeta(sessionDir: string, meta: SessionMeta): Promise<void> {
  const content = yaml.dump(meta);
  await writeFile(join(sessionDir, 'meta.yaml'), content, 'utf-8');
}

/**
 * 从 meta.yaml 读取 SessionMeta
 *
 * @param sessionDir - session 目录路径
 * @returns SessionMeta 或 null（文件不存在时）
 */
export async function readMeta(sessionDir: string): Promise<SessionMeta | null> {
  try {
    const content = await readFile(join(sessionDir, 'meta.yaml'), 'utf-8');
    return yaml.load(content) as SessionMeta;
  } catch {
    return null;
  }
}
