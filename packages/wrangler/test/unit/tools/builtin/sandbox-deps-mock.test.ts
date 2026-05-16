import { describe, it, expect, vi } from 'vitest';
import { SandboxToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import type { Sandbox } from '@agentskillmania/sandbox';

function createMockSandbox() {
  return {
    run: vi.fn(),
    getSandboxDir: vi.fn().mockReturnValue('/workspace'),
    updateConfig: vi.fn(),
  } as unknown as Sandbox;
}

describe('SandboxToolDeps (mock sandbox)', () => {
  let sandbox: ReturnType<typeof createMockSandbox>;
  let deps: SandboxToolDeps;

  beforeEach(() => {
    sandbox = createMockSandbox();
    deps = new SandboxToolDeps(sandbox);
  });

  describe('resolvePath', () => {
    it('resolves relative path within /workspace', () => {
      expect(deps.resolvePath('src/index.ts')).toBe('/workspace/src/index.ts');
    });

    it('resolves workspace root', () => {
      expect(deps.resolvePath('.')).toBe('/workspace');
    });

    it('rejects path traversal', () => {
      expect(() => deps.resolvePath('../etc/passwd')).toThrow('Path traversal');
    });

    it('rejects absolute escape', () => {
      expect(() => deps.resolvePath('/etc/passwd')).toThrow('Path traversal');
    });
  });

  describe('exec', () => {
    it('delegates to sandbox.run', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'hello',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.exec('echo hello');
      expect(result.stdout).toBe('hello');
      expect(result.exitCode).toBe(0);
      expect(sandbox.run).toHaveBeenCalledWith('echo hello');
    });

    it('returns non-zero exit code', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'not found',
        stderr: '',
        exitCode: 127,
      });
      const result = await deps.exec('bad_command');
      expect(result.exitCode).toBe(127);
    });
  });

  describe('readFile', () => {
    it('reads file content via sandbox', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'file content',
        stderr: '',
        exitCode: 0,
      });
      const content = await deps.readFile('test.txt');
      expect(content).toBe('file content');
      expect(sandbox.run).toHaveBeenCalledWith('cat /workspace/test.txt');
    });

    it('throws on read failure', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'No such file',
        stderr: '',
        exitCode: 1,
      });
      await expect(deps.readFile('missing.txt')).rejects.toThrow('Failed to read');
    });
  });

  describe('writeFile', () => {
    it('creates directory and writes file via sandbox stdin', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      await deps.writeFile('src/new.txt', 'hello');
      // First call: mkdir -p
      expect(sandbox.run).toHaveBeenNthCalledWith(1, 'mkdir -p /workspace/src');
      // Second call: cat > file with stdin
      expect(sandbox.run).toHaveBeenNthCalledWith(2, 'cat > /workspace/src/new.txt', {
        stdin: 'hello',
      });
    });

    it('throws on write failure', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mkdir succeeds
        .mockResolvedValueOnce({ stdout: 'Permission denied', stderr: '', exitCode: 1 }); // cat fails
      await expect(deps.writeFile('denied.txt', 'data')).rejects.toThrow('Failed to write');
    });
  });

  describe('editFile', () => {
    it('replaces single occurrence', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'foo bar baz',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.editFile('test.txt', 'bar', 'qux');
      expect(result).toContain('replaced 1 occurrence');
    });

    it('errors when oldString not found', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.editFile('test.txt', 'missing', 'new');
      expect(result).toContain('not found');
    });

    it('errors when oldString equals newString', async () => {
      const result = await deps.editFile('test.txt', 'same', 'same');
      expect(result).toContain('identical');
    });

    it('errors on duplicate match without replaceAll', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'abc abc',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.editFile('test.txt', 'abc', 'xyz');
      expect(result).toContain('Found 2 matches');
    });

    it('replaces all with replaceAll flag', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'aaa bbb aaa',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.editFile('test.txt', 'aaa', 'ccc', true);
      expect(result).toContain('replaced 2 occurrence');
    });
  });

  describe('glob', () => {
    it('returns matching files from ls -R output', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '/workspace:\na.ts\nb.ts\nc.js\n',
        stderr: '',
        exitCode: 0,
      });
      const files = await deps.glob('**/*.ts');
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some((f) => f.endsWith('a.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('b.ts'))).toBe(true);
      expect(files.some((f) => f.endsWith('c.js'))).toBe(false);
    });

    it('returns empty for no matches', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '/workspace:\na.ts\n',
        stderr: '',
        exitCode: 0,
      });
      const files = await deps.glob('**/*.xyz');
      expect(files).toEqual([]);
    });

    it('returns empty for failed ls', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1,
      });
      const files = await deps.glob('**/*.ts');
      expect(files).toEqual([]);
    });

    it('handles nested directory listing', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '/workspace:\nsrc\n\n/workspace/src:\nindex.ts\n',
        stderr: '',
        exitCode: 0,
      });
      const files = await deps.glob('**/*.ts');
      expect(files).toContain('src/index.ts');
    });
  });

  describe('grep', () => {
    it('returns matching lines via sandbox grep', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '/workspace/test.txt:1:hello world',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.grep('hello', '.');
      expect(result).toContain('hello world');
    });

    it('returns no matches for failed grep', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1,
      });
      const result = await deps.grep('notfound', '.');
      expect(result).toContain('No matches');
    });

    it('passes include option to grep', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1,
      });
      await deps.grep('pattern', '.', { include: '*.ts' });
      expect(sandbox.run).toHaveBeenCalledWith('grep -rn "pattern" /workspace --include="*.ts"');
    });
  });
});
