import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { NodeHostEnv } from '../../../src/host-env/node-host-env.js';
import { RuntimeCapabilityError } from '../../../src/host-env/types.js';

describe('NodeHostEnv', () => {
  const env = new NodeHostEnv();

  describe('crypto', () => {
    it('uuid() 返回合法的 UUID v4 格式', () => {
      const id = env.crypto.uuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('uuid() 每次返回不同的值', () => {
      expect(env.crypto.uuid()).not.toBe(env.crypto.uuid());
    });

    it('hash() 返回十六进制字符串', () => {
      const h = env.crypto.hash('/test/workspace');
      expect(h).toMatch(/^[0-9a-f]+$/);
      expect(h.length).toBeGreaterThan(0);
    });

    it('hash() 相同输入返回相同输出（确定性）', () => {
      expect(env.crypto.hash('/test/workspace')).toBe(env.crypto.hash('/test/workspace'));
    });

    it('hash() 与现有 md5 行为兼容', () => {
      // 确认 Node 侧仍用 md5（SessionStore 的 workspaceHash 兼容性）
      const { createHash } = require('node:crypto');
      const expected = createHash('md5').update('/test/workspace').digest('hex');
      expect(env.crypto.hash('/test/workspace')).toBe(expected);
    });
  });

  describe('path', () => {
    it('join / resolve / dirname / basename / extname 行为与 node:path 一致', () => {
      expect(env.path.join('a', 'b', 'c')).toBe(join('a', 'b', 'c'));
      expect(env.path.dirname('/a/b/c')).toBe('/a/b');
      expect(env.path.basename('/a/b/c.txt')).toBe('c.txt');
      expect(env.path.extname('/a/b/c.txt')).toBe('.txt');
    });

    it('isAbsolute / normalize / sep', () => {
      expect(env.path.isAbsolute('/a/b')).toBe(true);
      expect(env.path.isAbsolute('a/b')).toBe(false);
      expect(env.path.normalize('/a/./b/../c')).toBe('/a/c');
      expect(typeof env.path.sep).toBe('string');
    });
  });

  describe('process', () => {
    it('exec 执行命令并返回 stdout', async () => {
      const result = await env.process.exec('echo hello');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('execArray 执行命令并返回 stdout', async () => {
      const result = await env.process.execArray('echo', ['world']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('world');
    });

    it('exec 命令失败时返回非零 exitCode', async () => {
      const result = await env.process.exec('exit 1');
      expect(result.exitCode).not.toBe(0);
    });

    it('byteLength 与 Buffer.byteLength 一致', () => {
      expect(env.process.byteLength('hello')).toBe(5);
      expect(env.process.byteLength('你好')).toBe(6); // UTF-8 中文 3 字节
    });
  });

  describe('env', () => {
    it('platform 是 node 的平台标识', () => {
      expect(['win32', 'darwin', 'linux']).toContain(env.env.platform);
    });

    it('vars 包含 PATH（大多数环境）', () => {
      expect(typeof env.env.vars.PATH).toBe('string');
    });

    it('appDataDir 返回字符串路径', () => {
      const dir = env.env.appDataDir();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });

    it('cwd 返回当前工作目录', () => {
      expect(env.env.cwd()).toBe(process.cwd());
    });

    it('detectShell 返回 ShellInfo', () => {
      const shell = env.env.detectShell();
      expect(shell).not.toBeNull();
      expect(typeof shell!.path).toBe('string');
      expect(typeof shell!.name).toBe('string');
    });
  });

  describe('fs', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `wrangler-test-hostenv-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true });
    });

    it('writeFile / readFile 往返', async () => {
      const file = join(testDir, 'test.txt');
      await env.fs.writeFile(file, 'hello world');
      const content = await env.fs.readFile(file);
      expect(content).toBe('hello world');
    });

    it('exists 返回 true/false', async () => {
      const file = join(testDir, 'exists.txt');
      expect(await env.fs.exists(file)).toBe(false);
      await env.fs.writeFile(file, 'content');
      expect(await env.fs.exists(file)).toBe(true);
    });

    it('stat 返回正确的文件信息', async () => {
      const file = join(testDir, 'stat.txt');
      await env.fs.writeFile(file, '12345');
      const stat = await env.fs.stat(file);
      expect(stat.exists).toBe(true);
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(5);
    });

    it('mkdir 创建目录', async () => {
      const dir = join(testDir, 'subdir', 'nested');
      await env.fs.mkdir(dir, { recursive: true });
      expect(await env.fs.exists(dir)).toBe(true);
    });

    it('readdir 列出目录条目', async () => {
      await env.fs.writeFile(join(testDir, 'a.txt'), 'a');
      await env.fs.writeFile(join(testDir, 'b.txt'), 'b');
      const entries = await env.fs.readdir(testDir);
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['a.txt', 'b.txt']);
    });

    it('editFile 替换内容', async () => {
      const file = join(testDir, 'edit.txt');
      await env.fs.writeFile(file, 'foo bar baz');
      const result = await env.fs.editFile(file, 'bar', 'QUX');
      expect(result).toBe('foo QUX baz');
      expect(await env.fs.readFile(file)).toBe('foo QUX baz');
    });

    it('editFile replaceAll 替换全部', async () => {
      const file = join(testDir, 'edit-all.txt');
      await env.fs.writeFile(file, 'a-a-a');
      await env.fs.editFile(file, 'a', 'X', true);
      expect(await env.fs.readFile(file)).toBe('X-X-X');
    });

    it('glob 匹配文件', async () => {
      await env.fs.writeFile(join(testDir, 'a.ts'), '');
      await env.fs.writeFile(join(testDir, 'b.ts'), '');
      await env.fs.writeFile(join(testDir, 'c.md'), '');
      const matches = await env.fs.glob('*.ts', { cwd: testDir });
      expect(matches.sort()).toEqual(['a.ts', 'b.ts']);
    });

    it('isBinary 识别文本文件', async () => {
      const file = join(testDir, 'text.txt');
      await env.fs.writeFile(file, 'plain text content');
      expect(await env.fs.isBinary(file)).toBe(false);
    });
  });

  describe('resources', () => {
    it('resolvePackagePath 找到 wrangler 包', () => {
      const pkgPath = env.resources.resolvePackagePath('@agentskillmania/wrangler');
      expect(pkgPath).not.toBeNull();
      expect(pkgPath!.length).toBeGreaterThan(0);
    });

    it('resolvePackagePath 对不存在的包返回 null', () => {
      const pkgPath = env.resources.resolvePackagePath('@nonexistent/fake-pkg');
      expect(pkgPath).toBeNull();
    });

    it('builtinSkillDirs 返回非空数组', () => {
      const dirs = env.resources.builtinSkillDirs();
      expect(Array.isArray(dirs)).toBe(true);
      expect(dirs.length).toBeGreaterThan(0);
    });
  });

  describe('RuntimeCapabilityError', () => {
    it('构造时包含 capability 和 message', () => {
      const err = new RuntimeCapabilityError('exec', 'Browser host cannot spawn processes');
      expect(err.capability).toBe('exec');
      expect(err.message).toContain('exec');
      expect(err.message).toContain('Browser host cannot spawn processes');
      expect(err.name).toBe('RuntimeCapabilityError');
    });
  });
});
