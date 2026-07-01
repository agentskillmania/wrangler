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

  describe('execArray', () => {
    it('quotes each argv element and joins into a single sandbox.run command', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      });
      await deps.execArray('git', ['status', '--porcelain']);
      // shell-quote joins argv with spaces; safe tokens stay unquoted.
      expect(sandbox.run).toHaveBeenCalledTimes(1);
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(cmd).toContain('git');
      expect(cmd).toContain('status');
      expect(cmd).toContain('--porcelain');
    });

    it('shell-quotes an argument containing $() so it cannot inject', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      await deps.execArray('echo', ['$(touch /workspace/PWNED)']);
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      // The malicious content must be inside single quotes
      expect(cmd).toContain("'$(touch /workspace/PWNED)'");
      // Must NOT contain a raw unquoted $( that wsh would expand
      expect(cmd).not.toMatch(/[^']\$\(/);
    });

    it('shell-quotes an argument containing a semicolon', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
      await deps.execArray('echo', ['a; rm -rf /workspace']);
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(cmd).toContain("'a; rm -rf /workspace'");
    });

    it('propagates sandbox.run exit code and output', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'out',
        stderr: 'err',
        exitCode: 2,
      });
      const result = await deps.execArray('git', ['push']);
      expect(result).toEqual({ stdout: 'out', stderr: 'err', exitCode: 2 });
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
      expect(files).toHaveLength(2);
      const normalized = files.map((f) => f.replace(/\\/g, '/'));
      expect(normalized).toEqual(
        expect.arrayContaining([expect.stringMatching(/a\.ts$/), expect.stringMatching(/b\.ts$/)])
      );
      expect(normalized.filter((f) => f.endsWith('c.js'))).toHaveLength(0);
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
      // pattern and include are shell-escaped via POSIX single-quoting (SEC2).
      const call = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(call).toContain("--include='*.ts'");
    });
  });

  // ─── SEC2: sandbox grep command-injection guards ──────────
  // The grep pattern is an untrusted regex from the LLM and is interpolated
  // into a shell command run inside the WASM sandbox (wsh). wsh DOES expand
  // $() and backticks inside double quotes, so the pattern MUST be wrapped in
  // POSIX single-quotes (with internal single-quotes escaped as '\''), which
  // makes every character literal. These guards assert on the COMMAND STRING
  // passed to sandbox.run — proving the pattern is single-quoted, not raw or
  // double-quoted.

  describe('SEC2: grep pattern is POSIX single-quoted (no shell injection)', () => {
    beforeEach(() => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1,
      });
    });

    it('wraps a benign pattern in single quotes', async () => {
      await deps.grep('getUserById', '.');
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(cmd).toContain("'getUserById'");
      // Must NOT use double quotes around the pattern
      expect(cmd).not.toMatch(/"getUserById"/);
    });

    it('single-quotes a pattern containing $() command substitution', async () => {
      const malicious = 'x$(touch /workspace/PWNED)y';
      await deps.grep(malicious, '.');
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      // The literal $() must appear inside single quotes, not be executed.
      expect(cmd).toContain(`'${malicious}'`);
      // No raw double-quoted form that wsh would expand.
      expect(cmd).not.toMatch(/"\$\(/);
    });

    it('single-quotes a pattern containing backticks', async () => {
      const malicious = 'x`touch /workspace/PWNED`y';
      await deps.grep(malicious, '.');
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(cmd).toContain(`'${malicious}'`);
    });

    it('escapes internal single-quotes in the pattern (POSIX backslash-quote sequence)', async () => {
      // A pattern that itself contains a single quote — the escape sequence
      // '\'' must be used, otherwise the quote would close the wrapping and
      // allow injection.
      const withQuote = "foo'bar";
      await deps.grep(withQuote, '.');
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      expect(cmd).toContain("'foo'\\''bar'");
    });

    it('single-quotes the --include glob option', async () => {
      const maliciousInclude = '*.ts"; touch /workspace/PWNED; echo "';
      await deps.grep('foo', '.', { include: maliciousInclude });
      const cmd = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
      // The include value must be single-quoted, not raw double-quoted.
      expect(cmd).toContain(`--include='${maliciousInclude.replace(/'/g, "'\\''")}'`);
      expect(cmd).not.toMatch(/--include=".*touch/);
    });
  });

  describe('statFile', () => {
    it('should return exists=true isFile=true when test -f succeeds', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'YES',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.statFile('test.txt');
      expect(result).toEqual({ exists: true, isFile: true });
      expect(sandbox.run).toHaveBeenCalledWith(
        'test -f /workspace/test.txt && echo YES || echo NO'
      );
    });

    it('should return exists=true isFile=false for directory', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: 'NO', stderr: '', exitCode: 0 }) // test -f fails
        .mockResolvedValueOnce({ stdout: 'YES', stderr: '', exitCode: 0 }); // test -d succeeds
      const result = await deps.statFile('somedir');
      expect(result).toEqual({ exists: true, isFile: false });
    });

    it('should return exists=false when item does not exist', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'NO',
        stderr: '',
        exitCode: 0,
      });
      const result = await deps.statFile('missing.txt');
      expect(result).toEqual({ exists: false, isFile: false });
    });
  });

  describe('isBinaryFile (deps method)', () => {
    it('should return true when null bytes detected (stripped size < original)', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: '100\n', stderr: '', exitCode: 0 }) // wc -c (original)
        .mockResolvedValueOnce({ stdout: '50\n', stderr: '', exitCode: 0 }); // tr -d + wc -c (stripped)
      expect(await deps.isBinaryFile('binary.bin')).toBe(true);
      expect(sandbox.run).toHaveBeenCalledWith('wc -c < /workspace/binary.bin');
      expect(sandbox.run).toHaveBeenCalledWith('tr -d "\\000" < /workspace/binary.bin | wc -c');
    });

    it('should return false when no null bytes (stripped size equals original)', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: '100\n', stderr: '', exitCode: 0 }) // wc -c (original)
        .mockResolvedValueOnce({ stdout: '100\n', stderr: '', exitCode: 0 }); // tr -d + wc -c (same)
      expect(await deps.isBinaryFile('text.txt')).toBe(false);
    });

    it('should return false when wc command fails', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      });
      expect(await deps.isBinaryFile('missing.txt')).toBe(false);
    });

    it('should return false when original size is 0', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '0\n',
        stderr: '',
        exitCode: 0,
      });
      expect(await deps.isBinaryFile('empty.txt')).toBe(false);
    });
  });
});
