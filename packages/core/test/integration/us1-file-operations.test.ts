/**
 * User Story: US1 注册文件操作工具
 *
 * 作为开发者，我用 createBuiltinTools(deps) 获取一组文件操作工具，
 * 传入 workspace 路径和配置，拿到 Tool 数组后注册到我的 AgentRunner。
 *
 * Prerequisites: None (all file operations use local filesystem)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuiltinTools } from '../../src/tools/builtin/index.js';

describe('US1: File operation tools', () => {
  let workspace: string;
  let tools: ReturnType<typeof createBuiltinTools>;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-us1-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    tools = createBuiltinTools({ workspacePath: workspace });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  function getTool(name: string) {
    return tools.find((t) => t.name === name)!;
  }

  it('createBuiltinTools returns file_read, file_write, file_edit, glob, grep', () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_edit');
    expect(names).toContain('glob');
    expect(names).toContain('grep');
  });

  describe('file_read', () => {
    it('reads file content with line numbers', async () => {
      await writeFile(join(workspace, 'hello.txt'), 'hello\nworld\n');
      const result = await getTool('file_read').execute({ filePath: 'hello.txt' });
      expect(result).toContain('1:hello');
      expect(result).toContain('2:world');
    });

    it('supports offset/limit pagination', async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      await writeFile(join(workspace, 'data.txt'), lines.join('\n'));
      const result = await getTool('file_read').execute({
        filePath: 'data.txt',
        offset: 5,
        limit: 3,
      });
      expect(result).toContain('5:line 5');
      expect(result).toContain('7:line 7');
      expect(result).not.toContain('4:line 4');
      expect(result).not.toContain('8:line 8');
    });

    it('rejects path traversal', async () => {
      await expect(getTool('file_read').execute({ filePath: '../../etc/passwd' })).rejects.toThrow(
        'Path traversal detected'
      );
    });
  });

  describe('file_write', () => {
    it('creates a new file', async () => {
      const result = await getTool('file_write').execute({
        filePath: 'new.txt',
        content: 'created',
      });
      expect(result).toContain('File written');
      const content = await readFile(join(workspace, 'new.txt'), 'utf8');
      expect(content).toBe('created');
    });

    it('overwrites existing file', async () => {
      await writeFile(join(workspace, 'existing.txt'), 'old');
      await getTool('file_write').execute({
        filePath: 'existing.txt',
        content: 'new',
      });
      const content = await readFile(join(workspace, 'existing.txt'), 'utf8');
      expect(content).toBe('new');
    });

    it('rejects path traversal', async () => {
      await expect(
        getTool('file_write').execute({ filePath: '../evil.txt', content: 'hack' })
      ).rejects.toThrow('Path traversal detected');
    });
  });

  describe('file_edit', () => {
    it('replaces text in file', async () => {
      await writeFile(join(workspace, 'edit.txt'), 'foo bar baz');
      const result = await getTool('file_edit').execute({
        filePath: 'edit.txt',
        oldString: 'bar',
        newString: 'qux',
      });
      expect(result).toContain('replaced 1 occurrence');
      const content = await readFile(join(workspace, 'edit.txt'), 'utf8');
      expect(content).toBe('foo qux baz');
    });

    it('rejects path traversal', async () => {
      await expect(
        getTool('file_edit').execute({
          filePath: '../../etc/hosts',
          oldString: 'x',
          newString: 'y',
        })
      ).rejects.toThrow('Path traversal detected');
    });
  });

  describe('glob', () => {
    it('finds files by pattern', async () => {
      await writeFile(join(workspace, 'a.ts'), '');
      await writeFile(join(workspace, 'b.ts'), '');
      await writeFile(join(workspace, 'c.js'), '');
      const result = await getTool('glob').execute({ pattern: '**/*.ts' });
      expect(result).toContain('a.ts');
      expect(result).toContain('b.ts');
      expect(result).not.toContain('c.js');
    });
  });

  describe('grep', () => {
    it('searches file contents', async () => {
      await writeFile(
        join(workspace, 'code.ts'),
        'function getUser(id) {\n  return db.find(id);\n}'
      );
      const result = await getTool('grep').execute({ pattern: 'getUser' });
      expect(result).toContain('code.ts');
      expect(result).toContain('getUser');
    });

    it('filters by include pattern', async () => {
      await writeFile(join(workspace, 'app.ts'), 'import { x } from "./mod"');
      await writeFile(join(workspace, 'app.js'), 'import { y } from "./mod"');
      const result = await getTool('grep').execute({ pattern: 'import', include: '*.ts' });
      expect(result).toContain('app.ts');
      expect(result).not.toContain('app.js');
    });
  });

  describe('end-to-end workflow: read → edit → verify', () => {
    it('reads file, edits it, and reads again to confirm change', async () => {
      // Create initial file
      await getTool('file_write').execute({
        filePath: 'config.json',
        content: '{\n  "name": "wrangler",\n  "version": "0.1.0"\n}',
      });

      // Read it
      const read1 = await getTool('file_read').execute({ filePath: 'config.json' });
      expect(read1).toContain('wrangler');

      // Edit it
      const edit = await getTool('file_edit').execute({
        filePath: 'config.json',
        oldString: '"version": "0.1.0"',
        newString: '"version": "0.2.0"',
      });
      expect(edit).toContain('replaced 1 occurrence');

      // Read again to verify
      const read2 = await getTool('file_read').execute({ filePath: 'config.json' });
      expect(read2).toContain('0.2.0');
      expect(read2).not.toContain('0.1.0');
    });
  });
});
