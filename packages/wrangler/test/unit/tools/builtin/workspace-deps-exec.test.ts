/**
 * @fileoverview Unit tests for HostToolDeps command execution contract.
 *
 * Source file under test: src/tools/builtin/workspace-deps.ts (HostToolDeps).
 *
 * After the HostEnv refactor, HostToolDeps.grep delegates to
 * `runtime.fs.grep`. In the Node runtime, NodeHostEnvFs.grep invokes ripgrep
 * via execFileAsync (no shell) — identical to the original implementation.
 *
 * These tests use a real temp workspace + real NodeHostEnv + real ripgrep to
 * verify: (1) grep finds matches correctly, (2) patterns containing shell
 * metacharacters ($(), backticks, ;) are treated as literal regex by ripgrep,
 * never as shell syntax (SEC1), (3) output format and include filter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';

describe('HostToolDeps command execution contract (real ripgrep)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), `sec1-${Date.now()}-`));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('SEC1: grep treats untrusted patterns as literal regex (not shell syntax)', () => {
    it('treats a pattern containing $() as a literal regex', async () => {
      writeFileSync(join(workspace, 'a.ts'), 'has $(touch /tmp/should-not-exist) inside\n');
      const deps = new HostToolDeps(new NodeHostEnv(), workspace);
      // ripgrep receives the pattern as a literal argv element (execFile,
      // no shell). $() is regex syntax, never command substitution.
      const out = await deps.grep('\\$\\(touch /tmp/should-not-exist\\)', '.');
      expect(out).not.toBe('No matches found');
    });

    it('treats a pattern containing backticks as a literal regex', async () => {
      writeFileSync(join(workspace, 'a.ts'), 'echo `whoami` here\n');
      const deps = new HostToolDeps(new NodeHostEnv(), workspace);
      const out = await deps.grep('`whoami`', '.');
      expect(out).not.toBe('No matches found');
    });

    it('treats a pattern containing a semicolon as a literal regex', async () => {
      writeFileSync(join(workspace, 'a.ts'), 'foo; bar\n');
      const deps = new HostToolDeps(new NodeHostEnv(), workspace);
      const out = await deps.grep('foo; bar', '.');
      expect(out).not.toBe('No matches found');
    });
  });

  describe('grep output format (ripgrep raw output)', () => {
    it('returns ripgrep-style file:line:content lines', async () => {
      writeFileSync(join(workspace, 'a.ts'), 'first\nhello world\nthird\n');
      const deps = new HostToolDeps(new NodeHostEnv(), workspace);
      const out = await deps.grep('hello', '.');
      expect(out).not.toBe('No matches found');
      // ripgrep output: path:line:content
      for (const line of out.split('\n')) {
        if (line.trim()) {
          expect(line.startsWith(`${join(workspace, 'a.ts')}:2:`)).toBe(true);
        }
      }
    });

    it('returns "No matches found" when nothing matches', async () => {
      writeFileSync(join(workspace, 'a.ts'), 'nothing here\n');
      const deps = new HostToolDeps(new NodeHostEnv(), workspace);
      const out = await deps.grep('zzz-nope', '.');
      expect(out).toBe('No matches found');
    });

    it('applies the include filter (ripgrep --glob, recursive)', async () => {
      mkdirSync(join(workspace, 'src'), { recursive: true });
      writeFileSync(join(workspace, 'src', 'a.ts'), 'const foo = 1;');
      writeFileSync(join(workspace, 'src', 'b.js'), 'const foo = 2;');
      const deps = new HostToolDeps(new NodeHostEnv(), workspace);
      const out = await deps.grep('foo', '.', { include: '*.ts' });
      expect(out).toContain('a.ts');
      expect(out).not.toContain('b.js');
    });
  });
});
