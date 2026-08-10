import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_MAX_TOOL_OUTPUT,
  SandboxToolDeps,
} from '../../../../src/tools/builtin/workspace-deps.js';
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
    it('resolves relative path within / (workspace-as-root mapping)', () => {
      expect(deps.resolvePath('src/index.ts')).toBe('/src/index.ts');
    });

    it('resolves workspace root as /', () => {
      expect(deps.resolvePath('.')).toBe('/');
    });

    it('accepts path under /', () => {
      expect(deps.resolvePath('/src/index.ts')).toBe('/src/index.ts');
    });
  });

  describe('defaultTimeout parameterization', () => {
    it('defaults to 600000ms when not specified', () => {
      const d = new SandboxToolDeps(sandbox);
      // SandboxToolDeps.exec ignores timeout (sandbox has its own), so we just
      // verify construction with default succeeds. The timeout is stored
      // internally and used by host-side execArray callers that support it.
      expect(d.maxOutputSize).toBe(DEFAULT_MAX_TOOL_OUTPUT);
      // exec delegates to sandbox.run — verify it still works
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
      });
      return expect(d.exec('echo hi')).resolves.toMatchObject({ exitCode: 0 });
    });

    it('accepts custom defaultTimeout in constructor', () => {
      const d = new SandboxToolDeps(sandbox, 2048, 300_000);
      expect(d.maxOutputSize).toBe(2048);
      // Construction does not throw — timeout accepted
      expect(d).toBeInstanceOf(SandboxToolDeps);
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
      expect(sandbox.run).toHaveBeenCalledWith('cat /test.txt');
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
      // First call: mkdir via execArray (quote, no extra quotes for safe chars)
      expect(sandbox.run).toHaveBeenNthCalledWith(1, 'mkdir -p /src');
      // Second call: cat > file with stdin (path shellSingleQuote'd)
      expect(sandbox.run).toHaveBeenNthCalledWith(2, "cat > '/src/new.txt'", {
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
        stdout: '/:\na.ts\nb.ts\nc.js\n',
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
        stdout: '/:\na.ts\n',
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
        stdout: '/:\nsrc\n\n/src:\nindex.ts\n',
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
      expect(sandbox.run).toHaveBeenCalledWith("test -f '/test.txt' && echo YES || echo NO");
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
      expect(sandbox.run).toHaveBeenCalledWith("wc -c < '/binary.bin'");
      expect(sandbox.run).toHaveBeenCalledWith('tr -d "\\000" < \'/binary.bin\' | wc -c');
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

  // ─── SEC5: path injection guards for all sandbox commands ──
  // Every SandboxToolDeps method that interpolates a file path into a sandbox
  // command must prevent shell injection. Methods that are pure "program +
  // args" use execArray (bypasses shell); methods relying on shell syntax
  // (redirects, pipes, &&) use shellSingleQuote on the path.

  describe('SEC5: paths with shell metacharacters are safely handled', () => {
    beforeEach(() => {
      (sandbox.run as ReturnType<typeof vi.fn>).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    });

    // Helper: get all sandbox.run command strings from the mock
    const runCmds = () =>
      (sandbox.run as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);

    // --- readFile (execArray: cat) ---

    it('readFile: path with $() does not inject (execArray quotes it)', async () => {
      await deps.readFile('x$(touch /workspace/PWNED)y.ts');
      const cmds = runCmds();
      // The dangerous path must appear quoted in the command, not raw
      const catCmd = cmds.find((c) => c.includes('cat'));
      expect(catCmd).toBeDefined();
      expect(catCmd).toContain("'"); // shell-quote wraps unsafe chars in single quotes
      expect(catCmd).not.toMatch(/cat .* \$\(touch/); // no raw unquoted $()
    });

    // --- writeFile (execArray: mkdir; shellSingleQuote: cat >) ---

    it('writeFile: mkdir path with spaces is safely quoted', async () => {
      await deps.writeFile('my dir/file.ts', 'content');
      const cmds = runCmds();
      const mkdirCmd = cmds.find((c) => c.includes('mkdir'));
      expect(mkdirCmd).toBeDefined();
      // "my dir" has a space — must be quoted
      expect(mkdirCmd).toMatch(/'.*my dir.*'/);
    });

    it('writeFile: cat > path with $() does not inject', async () => {
      await deps.writeFile('x$(touch /workspace/P)y.ts', 'content');
      const cmds = runCmds();
      const catCmd = cmds.find((c) => c.includes('cat >') || c.includes("cat>'"));
      expect(catCmd).toBeDefined();
      expect(catCmd).toContain("'"); // path is single-quoted
    });

    // --- glob (execArray: ls -R) ---

    it('glob: cwd path with semicolon does not inject', async () => {
      await deps.glob('*.ts', { cwd: 'foo; rm -rf /workspace' });
      const cmds = runCmds();
      const lsCmd = cmds.find((c) => c.includes('ls'));
      expect(lsCmd).toBeDefined();
      // The semicolon must be inside single quotes, not interpreted by shell
      expect(lsCmd).toMatch(/'[^']*;[^']*'/); // ; is between single quotes
    });

    // --- statFile (shellSingleQuote: test -f / test -d) ---

    it('statFile: path with $() does not inject into test -f', async () => {
      await deps.statFile('x$(touch /workspace/P)y.ts');
      const cmds = runCmds();
      const testCmd = cmds.find((c) => c.includes('test -f'));
      expect(testCmd).toBeDefined();
      // $() must be inside single quotes, not interpreted by shell
      expect(testCmd).toMatch(/'[^']*\$[^']*'/); // $ is between single quotes
    });

    // --- isBinaryFile (shellSingleQuote: wc -c < / tr <) ---

    it('isBinaryFile: path with semicolon does not inject into wc', async () => {
      (sandbox.run as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ stdout: '100\n', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: '100\n', stderr: '', exitCode: 0 });
      await deps.isBinaryFile('foo; rm.ts');
      const cmds = runCmds();
      const wcCmd = cmds.find((c) => c.includes('wc'));
      expect(wcCmd).toBeDefined();
      // The semicolon must be inside single quotes
      expect(wcCmd).toMatch(/'[^']*;[^']*'/); // ; is between single quotes
    });
  });
});
