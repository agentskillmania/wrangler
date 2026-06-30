/**
 * @fileoverview Unit tests for HostToolDeps command execution contract.
 *
 * Source file under test: src/tools/builtin/workspace-deps.ts (HostToolDeps).
 * Layer: UNIT — mocks node:child_process so no real process is spawned.
 *
 * These tests verify the EXECUTION CONTRACT of HostToolDeps methods that run
 * external commands:
 * - WHICH function is called (execFile vs exec)
 * - WHICH executable is invoked
 * - HOW arguments are passed (array vs string-concatenation)
 *
 * This is the unit-level home of the SEC1 regression guard: it asserts that
 * HostToolDeps.grep passes the untrusted pattern as a LITERAL array element to
 * execFile, never through a shell. This guard is environment-independent
 * (no ripgrep, no filesystem, no `touch` required).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Capture calls to both exec and execFile so we can assert WHICH path the
// method under test took. Both mocks satisfy promisify's (err, value) callback
// contract so no real process is spawned and no test hangs.
const execFileMock = vi.fn();
const execMock = vi.fn();
vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => {
    execMock(...args);
    const cb = args[args.length - 1] as (err: unknown, out: unknown) => void;
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
  },
  execFile: (...args: unknown[]) => {
    execFileMock(...args);
    const cb = args[args.length - 1] as (err: unknown, out: unknown) => void;
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' });
  },
  execSync: vi.fn(),
}));

// Import AFTER mock is registered.
const { HostToolDeps } = await import(
  '../../../../src/tools/builtin/workspace-deps.js'
);

describe('HostToolDeps command execution contract (unit, mocked child_process)', () => {
  let deps: InstanceType<typeof HostToolDeps>;

  beforeEach(() => {
    execFileMock.mockClear();
    execMock.mockClear();
    deps = new HostToolDeps(join(tmpdir(), `sec1-unit-${Date.now()}`));
  });

  describe('SEC1: grep must pass pattern as a literal execFile argument', () => {
    it('calls execFile (NOT exec) with rgPath as the executable', async () => {
      await deps.grep('foo', '.');
      expect(execFileMock).toHaveBeenCalledTimes(1);
      // First positional arg is the executable path — must be ripgrep.
      const exe = execFileMock.mock.calls[0]?.[0];
      expect(typeof exe).toBe('string');
      expect(exe).toMatch(/rg|ripgrep/);
    });

    it('passes the pattern VERBATIM as args[0], even with shell metacharacters', async () => {
      // A pattern that would be catastrophic if interpreted by a shell.
      const malicious = '$(rm -rf /); `whoami`; echo INJECTED';
      await deps.grep(malicious, '.');

      const args = execFileMock.mock.calls[0]?.[1] as unknown[];
      // The pattern must be the first element of the args array, byte-for-byte
      // equal to the input — no shell escaping, no truncation, no execution.
      expect(args[0]).toBe(malicious);
    });

    it('passes the pattern as a literal value when it contains $()', async () => {
      await deps.grep('$(touch /tmp/should-not-exist)', '.');
      const args = execFileMock.mock.calls[0]?.[1] as unknown[];
      expect(args[0]).toBe('$(touch /tmp/should-not-exist)');
    });

    it('passes the pattern as a literal value when it contains backticks', async () => {
      await deps.grep('`touch /tmp/should-not-exist`', '.');
      const args = execFileMock.mock.calls[0]?.[1] as unknown[];
      expect(args[0]).toBe('`touch /tmp/should-not-exist`');
    });

    it('passes the pattern as a literal value when it contains a semicolon', async () => {
      await deps.grep('foo; touch /tmp/should-not-exist', '.');
      const args = execFileMock.mock.calls[0]?.[1] as unknown[];
      expect(args[0]).toBe('foo; touch /tmp/should-not-exist');
    });

    it('passes the --glob include option without shell single-quote wrapping', async () => {
      // execFile does not go through a shell, so glob patterns must NOT be
      // wrapped in extra quotes (which rg would treat as literal characters).
      await deps.grep('foo', '.', { include: '*.ts' });
      const args = execFileMock.mock.calls[0]?.[1] as unknown[];
      const globIdx = args.indexOf('--glob');
      expect(globIdx).not.toBe(-1);
      expect(args[globIdx + 1]).toBe('*.ts'); // not "'*.ts'"
    });

    it('does NOT call exec (the shell-based path) for grep', async () => {
      // The secure implementation must route through execFile, not exec.
      // If grep regresses to string-concatenation + exec, this fails.
      await deps.grep('foo', '.');
      expect(execMock).not.toHaveBeenCalled();
      expect(execFileMock).toHaveBeenCalledTimes(1);
    });
  });
});
