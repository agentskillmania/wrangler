import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SandboxToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { Sandbox } from '@agentskillmania/sandbox';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const ENABLED = !!process.env.ENABLE_INTEGRATION_TESTS;

describe.skipIf(!ENABLED)('SandboxToolDeps', () => {
  let sandbox: Sandbox;
  let deps: SandboxToolDeps;
  let sandboxDir: string;
  let testTmpDir: string;

  beforeAll(() => {
    testTmpDir = mkdtempSync(join(tmpdir(), 'sandbox-deps-test-'));
    sandbox = new Sandbox({ sandboxDir: testTmpDir });
    sandboxDir = sandbox.getSandboxDir();
    deps = new SandboxToolDeps(sandbox);
  });

  afterAll(() => {
    try {
      rmSync(testTmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('resolvePath', () => {
    it('should resolve relative path within /workspace', () => {
      expect(deps.resolvePath('src/index.ts')).toBe('/workspace/src/index.ts');
    });

    it('should resolve workspace root', () => {
      expect(deps.resolvePath('.')).toBe('/workspace');
    });

    it('should reject path traversal', () => {
      expect(() => deps.resolvePath('../etc/passwd')).toThrow('Path traversal');
    });

    it('should reject absolute escape', () => {
      expect(() => deps.resolvePath('/etc/passwd')).toThrow('Path traversal');
    });
  });

  describe('exec', () => {
    it('should execute command and return stdout', async () => {
      const result = await deps.exec('echo hello sandbox');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello sandbox');
    });

    it('should return non-zero exit code on failure', async () => {
      const result = await deps.exec('ls /nonexistent_dir_xyz');
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('readFile + writeFile', () => {
    it('should write and read back simple text', async () => {
      await deps.writeFile('simple.txt', 'hello from sandbox');
      const content = await deps.readFile('simple.txt');
      expect(content).toContain('hello from sandbox');
    });

    it('should write and read back multi-line content', async () => {
      const content = 'line1\nline2\nline3\n';
      await deps.writeFile('multiline.txt', content);
      expect(await deps.readFile('multiline.txt')).toBe(content);
    });

    it('should write and read back unicode content', async () => {
      const content = '你好世界\n🎉 emoji\n日本語テスト';
      await deps.writeFile('unicode.txt', content);
      expect(await deps.readFile('unicode.txt')).toBe(content);
    });

    it('should write to nested directories', async () => {
      await deps.writeFile('deep/nested/dir/test.txt', 'nested content');
      expect(await deps.readFile('deep/nested/dir/test.txt')).toContain('nested content');
    });

    it('should overwrite existing file', async () => {
      await deps.writeFile('overwrite.txt', 'v1');
      await deps.writeFile('overwrite.txt', 'v2');
      expect(await deps.readFile('overwrite.txt')).toBe('v2');
    });

    it('should handle special shell characters', async () => {
      const content =
        'dollar: $foo\nbacktick: `echo hi`\nquotes: "double" \'single\'\nbackslash: \\\\path\nhash: # comment';
      await deps.writeFile('special.txt', content);
      expect(await deps.readFile('special.txt')).toBe(content);
    });

    it('should throw for non-existent file', async () => {
      await expect(deps.readFile('missing.txt')).rejects.toThrow('Failed to read');
    });
  });

  describe('editFile', () => {
    it('should replace single occurrence', async () => {
      await deps.writeFile('edit1.txt', 'foo bar baz');
      const result = await deps.editFile('edit1.txt', 'bar', 'qux');
      expect(result).toContain('replaced 1 occurrence');
      expect(await deps.readFile('edit1.txt')).toBe('foo qux baz');
    });

    it('should replace all occurrences', async () => {
      await deps.writeFile('edit2.txt', 'aaa bbb aaa bbb aaa');
      const result = await deps.editFile('edit2.txt', 'aaa', 'ccc', true);
      expect(result).toContain('replaced 3 occurrence');
      expect(await deps.readFile('edit2.txt')).toBe('ccc bbb ccc bbb ccc');
    });

    it('should error when oldString not found', async () => {
      await deps.writeFile('edit3.txt', 'hello');
      const result = await deps.editFile('edit3.txt', 'missing', 'new');
      expect(result).toContain('not found');
    });

    it('should error when oldString equals newString', async () => {
      await deps.writeFile('edit4.txt', 'hello');
      const result = await deps.editFile('edit4.txt', 'hello', 'hello');
      expect(result).toContain('identical');
    });

    it('should error on duplicate match without replaceAll', async () => {
      await deps.writeFile('edit5.txt', 'abc abc');
      const result = await deps.editFile('edit5.txt', 'abc', 'xyz');
      expect(result).toContain('Found 2 matches');
    });

    it('should handle unicode replacement', async () => {
      await deps.writeFile('edit6.txt', '你好\n世界\n你好');
      await deps.editFile('edit6.txt', '你好', '再见', true);
      expect(await deps.readFile('edit6.txt')).toBe('再见\n世界\n再见');
    });
  });

  describe('glob', () => {
    it('should find files matching pattern', async () => {
      writeFileSync(join(sandboxDir, 'glob_a.ts'), '');
      writeFileSync(join(sandboxDir, 'glob_b.ts'), '');
      writeFileSync(join(sandboxDir, 'glob_c.js'), '');

      const files = await deps.glob('**/*.ts');
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some((f) => f.endsWith('glob_a.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('glob_b.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('glob_c.js'))).toBe(false);
    });

    it('should return empty for no matches', async () => {
      const files = await deps.glob('**/*.nonexistent_xyz');
      expect(files).toEqual([]);
    });
  });

  describe('grep', () => {
    it('should find pattern in files', async () => {
      writeFileSync(join(sandboxDir, 'grep_test.txt'), 'const foo = 1;\nconst bar = 2;');
      const output = await deps.grep('foo', '.');
      expect(output).toContain('foo');
    });

    it('should report no matches', async () => {
      writeFileSync(join(sandboxDir, 'grep_empty.txt'), 'hello world');
      const output = await deps.grep('nonexistent_pattern_xyz', '.');
      expect(output).toContain('No matches');
    });
  });

  describe('statFile', () => {
    it('should return exists=true isFile=true for a regular file', async () => {
      writeFileSync(join(sandboxDir, 'stat-me.txt'), 'hello');
      const result = await deps.statFile('stat-me.txt');
      expect(result).toEqual({ exists: true, isFile: true });
    });

    it('should return exists=false for non-existent file', async () => {
      const result = await deps.statFile('does-not-exist.txt');
      expect(result).toEqual({ exists: false, isFile: false });
    });

    it('should return isFile=false for a subdirectory', async () => {
      // Create a subdirectory via shell so it exists inside the sandbox
      await deps.exec('mkdir -p subdir-for-stat');
      const result = await deps.statFile('subdir-for-stat');
      expect(result).toEqual({ exists: true, isFile: false });
    });
  });

  describe('isBinaryFile', () => {
    it('should detect binary file with null bytes', async () => {
      // Use sandbox shell to create a binary file (printf with null bytes)
      await deps.exec('printf "\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00hello" > binary.bin');
      expect(await deps.isBinaryFile('binary.bin')).toBe(true);
    });

    it('should return false for text file', async () => {
      writeFileSync(join(sandboxDir, 'text-file.txt'), 'hello world');
      expect(await deps.isBinaryFile('text-file.txt')).toBe(false);
    });

    it('should return false for non-existent file', async () => {
      expect(await deps.isBinaryFile('no-such-file.txt')).toBe(false);
    });
  });
});
