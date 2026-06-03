import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolvePath,
  truncateOutput,
  isBinaryFile,
  HostToolDeps,
  detectShell,
} from '../../../../src/tools/builtin/workspace-deps.js';
import type { ShellInfo } from '../../../../src/tools/builtin/workspace-deps.js';

describe('workspace-deps', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  const deps = () => ({ workspacePath: workspace });

  // --- resolvePath ---

  describe('resolvePath', () => {
    it('resolves relative path within workspace', () => {
      const result = resolvePath(deps(), 'src/index.ts');
      expect(result).toBe(join(workspace, 'src/index.ts'));
    });

    it('resolves absolute path within workspace', () => {
      const absPath = join(workspace, 'src/index.ts');
      const result = resolvePath(deps(), absPath);
      expect(result).toBe(absPath);
    });

    it('normalizes path with dots', () => {
      const result = resolvePath(deps(), 'src/../src/index.ts');
      expect(result).toBe(join(workspace, 'src/index.ts'));
    });

    it('rejects path traversal via ../../', () => {
      expect(() => resolvePath(deps(), '../../etc/passwd')).toThrow('Path traversal detected');
    });

    it('rejects absolute path outside workspace', () => {
      expect(() => resolvePath(deps(), '/etc/passwd')).toThrow('Path traversal detected');
    });

    it('rejects workspace sibling directory (prefix without separator)', () => {
      // /workspace-sibling should not match /workspace
      const sibling = workspace + '-sibling';
      expect(() => resolvePath(deps(), sibling)).toThrow('Path traversal detected');
    });
  });

  // --- truncateOutput ---

  describe('truncateOutput', () => {
    it('returns content as-is when under limit', () => {
      const { content, truncated } = truncateOutput('hello', 100);
      expect(content).toBe('hello');
      expect(truncated).toBe(false);
    });

    it('truncates when over limit and adds marker', () => {
      const longStr = 'a'.repeat(1000);
      const { content, truncated } = truncateOutput(longStr, 100);
      expect(truncated).toBe(true);
      expect(content).toContain('...[truncated]');
      expect(content.length).toBeLessThan(longStr.length);
    });

    it('does not split UTF-8 multi-byte characters', () => {
      // Each emoji is 4 bytes in UTF-8, 2 code units in JS string (surrogate pair)
      const emojis = '😀'.repeat(100); // 400 bytes
      const { content } = truncateOutput(emojis, 50); // marker is ~16 bytes, leaves ~34 bytes = 8 emojis
      expect(content).toContain('...[truncated]');
      const withoutMarker = content.replace('\n...[truncated]', '');
      // Should be whole emojis, not partial surrogate pairs
      expect(withoutMarker).toMatch(/^😀*$/u);
      expect(withoutMarker.length % 2).toBe(0); // each emoji is 2 code units
    });
  });

  // --- isBinaryFile ---

  describe('isBinaryFile', () => {
    it('detects binary file with null bytes', async () => {
      const path = join(workspace, 'test.zip');
      const buf = Buffer.alloc(100);
      for (let i = 0; i < 50; i++) buf[i] = 0;
      for (let i = 50; i < 100; i++) buf[i] = 65;
      await writeFile(path, buf);
      expect(await isBinaryFile(path)).toBe(true);
    });

    it('returns false for text file (.ts)', async () => {
      const path = join(workspace, 'test.ts');
      await writeFile(path, 'const x = 1;');
      expect(await isBinaryFile(path)).toBe(false);
    });

    it('returns false for text file (.json)', async () => {
      const path = join(workspace, 'test.json');
      await writeFile(path, '{}');
      expect(await isBinaryFile(path)).toBe(false);
    });

    it('returns false for text file (.md)', async () => {
      const path = join(workspace, 'test.md');
      await writeFile(path, '# Hello');
      expect(await isBinaryFile(path)).toBe(false);
    });

    it('returns false for empty file', async () => {
      const path = join(workspace, 'empty');
      await writeFile(path, '');
      expect(await isBinaryFile(path)).toBe(false);
    });

    it('returns false when file does not exist', async () => {
      const path = join(workspace, 'nope');
      expect(await isBinaryFile(path)).toBe(false);
    });
  });
});

describe('HostToolDeps', () => {
  let tempDir: string;
  let deps: HostToolDeps;

  beforeEach(() => {
    tempDir = join(tmpdir(), `host-deps-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    deps = new HostToolDeps(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('resolvePath', () => {
    it('should resolve relative path within workspace', () => {
      const result = deps.resolvePath('src/index.ts');
      expect(result).toBe(join(tempDir, 'src', 'index.ts'));
    });

    it('should reject path traversal attempts', () => {
      expect(() => deps.resolvePath('../etc/passwd')).toThrow('Path traversal');
    });

    it('should accept workspace root itself', () => {
      const result = deps.resolvePath('.');
      expect(result).toBe(tempDir);
    });
  });

  describe('readFile', () => {
    it('should read file content', async () => {
      await writeFile(join(tempDir, 'test.txt'), 'hello world');
      const content = await deps.readFile('test.txt');
      expect(content).toBe('hello world');
    });

    it('should throw for non-existent file', async () => {
      await expect(deps.readFile('missing.txt')).rejects.toThrow();
    });
  });

  describe('writeFile', () => {
    it('should write file content creating parent dirs', async () => {
      await deps.writeFile('sub/dir/test.txt', 'hello');
      const content = await deps.readFile('sub/dir/test.txt');
      expect(content).toBe('hello');
    });
  });

  describe('editFile', () => {
    it('should replace single occurrence', async () => {
      await writeFile(join(tempDir, 'test.txt'), 'foo bar baz');
      const result = await deps.editFile('test.txt', 'bar', 'qux');
      expect(result).toContain('replaced 1 occurrence');
      const content = await deps.readFile('test.txt');
      expect(content).toBe('foo qux baz');
    });

    it('should replace all occurrences', async () => {
      await writeFile(join(tempDir, 'test.txt'), 'aaa bbb aaa');
      const result = await deps.editFile('test.txt', 'aaa', 'ccc', true);
      expect(result).toContain('replaced 2 occurrence');
    });

    it('should error when oldString not found', async () => {
      await writeFile(join(tempDir, 'test.txt'), 'hello');
      const result = await deps.editFile('test.txt', 'missing', 'new');
      expect(result).toContain('not found');
    });

    it('should error when oldString === newString', async () => {
      await writeFile(join(tempDir, 'test.txt'), 'hello');
      const result = await deps.editFile('test.txt', 'hello', 'hello');
      expect(result).toContain('identical');
    });
  });

  describe('exec', () => {
    it('should execute command and return stdout', async () => {
      const result = await deps.exec('echo hello');
      expect(result.stdout.trim()).toBe('hello');
      expect(result.exitCode).toBe(0);
    });

    it('should capture stderr on failure', async () => {
      const result = await deps.exec('ls /nonexistent_dir_xyz');
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('glob', () => {
    it('should find files matching pattern', async () => {
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src', 'a.ts'), '');
      writeFileSync(join(tempDir, 'src', 'b.ts'), '');
      writeFileSync(join(tempDir, 'src', 'c.js'), '');

      const files = await deps.glob('**/*.ts');
      expect(files).toHaveLength(2);
      const normalized = files.map((f) => f.replace(/\\/g, '/'));
      expect(normalized).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\/src\/a\.ts$/),
          expect.stringMatching(/\/src\/b\.ts$/),
        ])
      );
    });
  });

  describe('grep', () => {
    it('should find pattern in files', async () => {
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src', 'a.ts'), 'const foo = 1;\nconst bar = 2;');
      writeFileSync(join(tempDir, 'src', 'b.ts'), 'const baz = 3;');

      const output = await deps.grep('foo', '.');
      expect(output).toContain('foo');
    });

    it('should report no matches', async () => {
      await writeFile(join(tempDir, 'test.txt'), 'hello world');
      const output = await deps.grep('nonexistent_pattern_xyz', '.');
      expect(output).toContain('No matches');
    });

    it('should filter by include pattern', async () => {
      mkdirSync(join(tempDir, 'src'), { recursive: true });
      writeFileSync(join(tempDir, 'src', 'a.ts'), 'const foo = 1;');
      writeFileSync(join(tempDir, 'src', 'b.js'), 'const foo = 2;');

      const output = await deps.grep('foo', '.', { include: '*.ts' });
      expect(output).toContain('a.ts');
    });
  });

  describe('statFile', () => {
    it('should return exists=true and isFile=true for a regular file', async () => {
      await writeFile(join(tempDir, 'regular.txt'), 'content');
      const result = await deps.statFile('regular.txt');
      expect(result).toEqual({ exists: true, isFile: true });
    });

    it('should return exists=false for non-existent file', async () => {
      const result = await deps.statFile('nope.txt');
      expect(result).toEqual({ exists: false, isFile: false });
    });

    it('should return isFile=false for a directory', async () => {
      mkdirSync(join(tempDir, 'subdir'), { recursive: true });
      const result = await deps.statFile('subdir');
      expect(result).toEqual({ exists: true, isFile: false });
    });

    it('should throw Permission denied for EACCES', async () => {
      await expect(deps.statFile('/root/.ssh/id_rsa')).rejects.toThrow();
    });
  });

  describe('isBinaryFile (deps method)', () => {
    it('should detect binary file with null bytes', async () => {
      const buf = Buffer.alloc(100);
      for (let i = 0; i < 50; i++) buf[i] = 0;
      await writeFile(join(tempDir, 'binary.bin'), buf);
      expect(await deps.isBinaryFile('binary.bin')).toBe(true);
    });

    it('should return false for text file', async () => {
      await writeFile(join(tempDir, 'text.txt'), 'hello world');
      expect(await deps.isBinaryFile('text.txt')).toBe(false);
    });

    it('should return false for non-existent file', async () => {
      expect(await deps.isBinaryFile('missing.txt')).toBe(false);
    });
  });

  describe('shell property', () => {
    it('should auto-detect shell', () => {
      expect(typeof deps.shell.path).toBe('string');
      expect(typeof deps.shell.name).toBe('string');
      expect(deps.shell.path.length).toBeGreaterThan(0);
      expect(deps.shell.name.length).toBeGreaterThan(0);
    });

    it('should accept explicit shell override', () => {
      const customShell: ShellInfo = { path: '/bin/custom', name: 'custom' };
      const customDeps = new HostToolDeps(tempDir, 1024, customShell);
      expect(customDeps.shell).toEqual(customShell);
    });

    it('should use detected shell for exec', async () => {
      // Shell is auto-detected and used in exec — verify echo still works
      const result = await deps.exec('echo test-shell');
      expect(result.stdout.trim()).toBe('test-shell');
    });
  });
});

describe('detectShell', () => {
  it('should return a shell with valid path and name', () => {
    const shell = detectShell();
    expect(typeof shell.path).toBe('string');
    expect(typeof shell.name).toBe('string');
    expect(shell.path.length).toBeGreaterThan(0);
    expect(shell.name.length).toBeGreaterThan(0);
  });

  it('should return a known shell name on unix', () => {
    if (process.platform === 'win32') return;
    const knownShells = ['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh'];
    const shell = detectShell();
    expect(knownShells).toContain(shell.name);
  });

  it('should return a known shell name on windows', () => {
    if (process.platform !== 'win32') return;
    const knownShells = ['pwsh', 'powershell', 'bash', 'cmd'];
    const shell = detectShell();
    expect(knownShells).toContain(shell.name);
  });
});
