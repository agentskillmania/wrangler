import yaml from 'js-yaml';

import { formatSpecFileName, parseSpecFileName } from './naming.js';
import type { SpecDocument, SpecMeta, SpecStatus } from './types.js';
import type { HostEnv } from '../host-env/index.js';

/** Valid status transitions for spec documents */
const VALID_TRANSITIONS: Record<SpecStatus, SpecStatus[]> = {
  draft: ['approved'],
  approved: ['superseded'],
  superseded: [],
};

/**
 * Spec 文档存储
 *
 * 直接在 baseDir 下存储 spec 文档，不再使用 workspace hash 子目录。
 * 文档格式为 YAML frontmatter + markdown body。
 * 文件名：{name}-spec-v{version}.md
 *
 * 所有 fs/path 操作通过 HostEnv 注入（浏览器走 OPFS，Node 走 node:fs）。
 */
export class SpecStore {
  constructor(
    private readonly baseDir: string,
    private readonly runtime: HostEnv
  ) {}

  private getWorkspaceDir(): string {
    return this.baseDir;
  }

  /** 保存 spec 文档 */
  async save(doc: SpecDocument): Promise<void> {
    const dir = this.getWorkspaceDir();
    await this.runtime.fs.mkdir(dir, { recursive: true });

    const fileName = formatSpecFileName({
      name: doc.meta.name,
      version: doc.meta.version,
    });
    const filePath = this.runtime.path.join(dir, fileName);

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
    await this.runtime.fs.writeFile(filePath, content);
  }

  /** 列出当前目录的所有 spec，按时间倒序 */
  async list(): Promise<SpecDocument[]> {
    const dir = this.getWorkspaceDir();
    let entries: import('../host-env/index.js').DirEntry[];
    try {
      entries = await this.runtime.fs.readdir(dir);
    } catch {
      return [];
    }

    const docs: SpecDocument[] = [];
    for (const entry of entries) {
      const parsed = parseSpecFileName(entry.name);
      if (!parsed) continue;
      const doc = await this.readSpecFile(this.runtime.path.join(dir, entry.name));
      if (doc) docs.push(doc);
    }

    return docs.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  }

  /** 获取指定名称和版本的 spec，不存在返回 null */
  async get(name: string, version: number): Promise<SpecDocument | null> {
    const dir = this.getWorkspaceDir();
    let entries: import('../host-env/index.js').DirEntry[];
    try {
      entries = await this.runtime.fs.readdir(dir);
    } catch {
      return null;
    }

    for (const entry of entries) {
      const parsed = parseSpecFileName(entry.name);
      if (parsed && parsed.name === name && parsed.version === version) {
        return this.readSpecFile(this.runtime.path.join(dir, entry.name));
      }
    }
    return null;
  }

  /** 获取指定名称的最新版本 spec */
  async getLatest(name: string): Promise<SpecDocument | null> {
    const dir = this.getWorkspaceDir();
    let entries: import('../host-env/index.js').DirEntry[];
    try {
      entries = await this.runtime.fs.readdir(dir);
    } catch {
      return null;
    }

    let latestVersion = 0;
    let latestFile: string | null = null;

    for (const entry of entries) {
      const parsed = parseSpecFileName(entry.name);
      if (parsed && parsed.name === name && parsed.version > latestVersion) {
        latestVersion = parsed.version;
        latestFile = entry.name;
      }
    }

    if (!latestFile) return null;
    return this.readSpecFile(this.runtime.path.join(dir, latestFile));
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
  private async readSpecFile(filePath: string): Promise<SpecDocument | null> {
    try {
      const content = await this.runtime.fs.readFile(filePath);
      return this.parseDocument(content);
    } catch {
      return null;
    }
  }

  /** 解析 YAML frontmatter + markdown body */
  private parseDocument(content: string): SpecDocument {
    const frontmatterEnd = content.indexOf('---', 4);
    if (frontmatterEnd === -1) {
      throw new Error('Invalid spec document: missing YAML frontmatter');
    }
    const yamlStr = content.slice(4, frontmatterEnd);
    const body = content.slice(frontmatterEnd + 3).trimStart();

    const meta = yaml.load(yamlStr) as SpecMeta;
    return { meta, body };
  }
}
