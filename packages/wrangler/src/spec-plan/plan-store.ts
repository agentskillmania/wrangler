import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import yaml from 'js-yaml';

import { formatPlanFileName, parsePlanFileName } from './naming.js';
import type { PlanDocument, PlanMeta, PlanStatus } from './types.js';

/** Valid status transitions for plan documents */
const VALID_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft: ['approved'],
  approved: ['executing'],
  executing: ['completed'],
  completed: [],
};

/**
 * Plan 文档存储
 *
 * 直接在 baseDir 下存储 plan 文档，不再使用 workspace hash 子目录。
 * plan 文件名包含 spec 版本和 plan 版本，可追溯到对应 spec。
 * 文件名：{name}-v{specVersion}-plan-v{version}.md
 */
export class PlanStore {
  constructor(private readonly baseDir: string) {}

  private getWorkspaceDir(): string {
    return this.baseDir;
  }

  /** 保存 plan 文档 */
  async save(doc: PlanDocument): Promise<void> {
    const dir = this.getWorkspaceDir();
    await mkdir(dir, { recursive: true });

    const fileName = formatPlanFileName({
      name: doc.meta.name,
      specVersion: doc.meta.specVersion,
      version: doc.meta.version,
    });
    const filePath = join(dir, fileName);

    const yamlFront = yaml.dump({
      name: doc.meta.name,
      specName: doc.meta.specName,
      specVersion: doc.meta.specVersion,
      version: doc.meta.version,
      status: doc.meta.status,
      workspacePath: doc.meta.workspacePath,
      createdAt: doc.meta.createdAt,
      updatedAt: doc.meta.updatedAt,
      ...(doc.meta.sessionId ? { sessionId: doc.meta.sessionId } : {}),
    });

    const content = `---\n${yamlFront}---\n${doc.body}`;
    await writeFile(filePath, content, 'utf-8');
  }

  /** 列出当前目录的所有 plan，按时间倒序 */
  async list(): Promise<PlanDocument[]> {
    const dir = this.getWorkspaceDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const docs: PlanDocument[] = [];
    for (const entry of entries) {
      const parsed = parsePlanFileName(entry);
      if (!parsed) continue;
      const doc = await this.readFile(join(dir, entry));
      if (doc) docs.push(doc);
    }

    return docs.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  }

  /** 获取指定 plan，不存在返回 null */
  async get(name: string, specVersion: number, version: number): Promise<PlanDocument | null> {
    const dir = this.getWorkspaceDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return null;
    }

    for (const entry of entries) {
      const parsed = parsePlanFileName(entry);
      if (
        parsed &&
        parsed.name === name &&
        parsed.specVersion === specVersion &&
        parsed.version === version
      ) {
        return this.readFile(join(dir, entry));
      }
    }
    return null;
  }

  /** 获取指定 spec 的最新 plan */
  async getLatestForSpec(specName: string, specVersion?: number): Promise<PlanDocument | null> {
    const dir = this.getWorkspaceDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return null;
    }

    let latestDoc: PlanDocument | null = null;

    for (const entry of entries) {
      const parsed = parsePlanFileName(entry);
      if (!parsed) continue;
      if (specVersion !== undefined && parsed.specVersion !== specVersion) continue;

      const doc = await this.readFile(join(dir, entry));
      if (!doc) continue;
      if (doc.meta.specName !== specName) continue;

      if (!latestDoc || doc.meta.version > latestDoc.meta.version) {
        latestDoc = doc;
      }
    }

    return latestDoc;
  }

  /** 更新 plan 状态（仅允许合法转换） */
  async updateStatus(
    name: string,
    specVersion: number,
    version: number,
    newStatus: PlanStatus
  ): Promise<void> {
    const doc = await this.get(name, specVersion, version);
    if (!doc) throw new Error(`Plan not found: ${name} v${version} (spec v${specVersion})`);

    const allowed = VALID_TRANSITIONS[doc.meta.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${doc.meta.status} → ${newStatus}. Allowed: ${allowed.join(', ')}`
      );
    }

    doc.meta.status = newStatus;
    doc.meta.updatedAt = new Date().toISOString();
    await this.save(doc);
  }

  /** 读取并解析单个 plan 文件 */
  private async readFile(filePath: string): Promise<PlanDocument | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return this.parseDocument(content);
    } catch {
      return null;
    }
  }

  /** 解析 YAML frontmatter + markdown body */
  private parseDocument(content: string): PlanDocument {
    const frontmatterEnd = content.indexOf('---', 4);
    if (frontmatterEnd === -1) {
      throw new Error('Invalid plan document: missing YAML frontmatter');
    }
    const yamlStr = content.slice(4, frontmatterEnd);
    const body = content.slice(frontmatterEnd + 3).trimStart();

    const meta = yaml.load(yamlStr) as PlanMeta;
    return { meta, body };
  }
}
