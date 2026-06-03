import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import yaml from 'js-yaml';

import { formatSpecFileName, parseSpecFileName } from './naming.js';
import type { SpecDocument, SpecMeta, SpecStatus } from './types.js';

/** Valid status transitions for spec documents */
const VALID_TRANSITIONS: Record<SpecStatus, SpecStatus[]> = {
  draft: ['approved'],
  approved: ['superseded'],
  superseded: [],
};

function hashWorkspacePath(workspacePath: string): string {
  const absolute = resolve(workspacePath);
  return createHash('md5').update(absolute).digest('hex');
}

/**
 * Spec 文档存储
 *
 * 按 workspace 路径 MD5 分组存储 spec 文档。
 * 文档格式为 YAML frontmatter + markdown body。
 */
export class SpecStore {
  private readonly workspaceHash: string;

  constructor(
    private readonly baseDir: string,
    private readonly workspacePath: string
  ) {
    this.workspaceHash = hashWorkspacePath(workspacePath);
  }

  private getWorkspaceDir(): string {
    return join(this.baseDir, this.workspaceHash);
  }

  /** 保存 spec 文档 */
  async save(doc: SpecDocument): Promise<void> {
    const dir = this.getWorkspaceDir();
    await mkdir(dir, { recursive: true });

    const fileName = formatSpecFileName({
      name: doc.meta.name,
      version: doc.meta.version,
      timestamp: doc.meta.createdAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15),
    });
    const filePath = join(dir, fileName);

    const yamlFront = yaml.dump({
      name: doc.meta.name,
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

  /** 列出当前 workspace 的所有 spec，按时间倒序 */
  async list(): Promise<SpecDocument[]> {
    const dir = this.getWorkspaceDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const docs: SpecDocument[] = [];
    for (const entry of entries) {
      const parsed = parseSpecFileName(entry);
      if (!parsed) continue;
      const doc = await this.readFile(join(dir, entry));
      if (doc) docs.push(doc);
    }

    return docs.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  }

  /** 获取指定名称和版本的 spec，不存在返回 null */
  async get(name: string, version: number): Promise<SpecDocument | null> {
    const dir = this.getWorkspaceDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return null;
    }

    for (const entry of entries) {
      const parsed = parseSpecFileName(entry);
      if (parsed && parsed.name === name && parsed.version === version) {
        return this.readFile(join(dir, entry));
      }
    }
    return null;
  }

  /** 获取指定名称的最新版本 spec */
  async getLatest(name: string): Promise<SpecDocument | null> {
    const dir = this.getWorkspaceDir();
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return null;
    }

    let latestVersion = 0;
    let latestFile: string | null = null;

    for (const entry of entries) {
      const parsed = parseSpecFileName(entry);
      if (parsed && parsed.name === name && parsed.version > latestVersion) {
        latestVersion = parsed.version;
        latestFile = entry;
      }
    }

    if (!latestFile) return null;
    return this.readFile(join(dir, latestFile));
  }

  /** 更新 spec 状态（仅允许合法转换） */
  async updateStatus(name: string, version: number, newStatus: SpecStatus): Promise<void> {
    const doc = await this.get(name, version);
    if (!doc) throw new Error(`Spec not found: ${name} v${version}`);

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

  /** 读取并解析单个 spec 文件 */
  private async readFile(filePath: string): Promise<SpecDocument | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return this.parseDocument(content);
    } catch {
      return null;
    }
  }

  /** 解析 YAML frontmatter + markdown body */
  private parseDocument(content: string): SpecDocument {
    const frontmatterEnd = content.indexOf('---', 4);
    const yamlStr = content.slice(4, frontmatterEnd);
    const body = content.slice(frontmatterEnd + 3).trimStart();

    const meta = yaml.load(yamlStr) as SpecMeta;
    return { meta, body };
  }
}
