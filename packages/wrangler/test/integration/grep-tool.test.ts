/**
 * @fileoverview Integration test: grep tool user story.
 *
 * User story: As a developer agent, I want to search file contents by regex
 * so that I can locate code and text across the workspace.
 *
 * Layer: INTEGRATION — uses a real HostToolDeps, real filesystem, and the real
 * ripgrep binary. No mocks. Validates the end-to-end behavior the user relies on.
 *
 * Also hosts the integration-level SEC1 regression guards: end-to-end proofs
 * that shell metacharacters in the pattern cannot achieve command execution
 * against the real host shell. (The unit-level contract guard lives in
 * workspace-deps-exec.test.ts.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGrepTool } from '../../src/tools/builtin/grep.js';
import { HostToolDeps } from '../../src/tools/builtin/workspace-deps.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';

describe('Integration: grep tool (real ripgrep)', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-int-grep-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
    deps = new HostToolDeps(new NodeHostEnv(), workspace);
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  // ─── User story: search code by regex ──────────────────────

  it('finds matches by regex', async () => {
    await writeFile(join(workspace, 'a.ts'), 'const x = getUserById(id);');
    await writeFile(join(workspace, 'b.ts'), 'const y = getUserById(yid);');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'getUserById' });
    expect(result).toContain('a.ts');
    expect(result).toContain('getUserById');
  });

  it('returns no matches message when nothing matches', async () => {
    await writeFile(join(workspace, 'a.ts'), 'hello');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'notfound' });
    expect(result).toContain('No matches found');
  });

  it('filters by include glob pattern', async () => {
    await writeFile(join(workspace, 'a.ts'), 'import { x }');
    await writeFile(join(workspace, 'b.js'), 'import { y }');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'import', include: '*.ts' });
    expect(result).toContain('a.ts');
    expect(result).not.toContain('b.js');
  });

  it('searches within a subpath', async () => {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'a.ts'), 'function helper() {}');
    await writeFile(join(workspace, 'root.ts'), 'function main() {}');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'function', path: 'src' });
    expect(result).toContain('helper');
    expect(result).not.toContain('main');
  });

  it('truncates long matching lines', async () => {
    await writeFile(join(workspace, 'long.txt'), 'x'.repeat(3000));
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'x{3000}' });
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(3000);
  });

  it('groups results by file', async () => {
    await writeFile(join(workspace, 'a.ts'), 'line1\nline2\nline3');
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'line' });
    expect(result).toContain('a.ts:');
  });

  it('caps results at 100 matches across multiple files', async () => {
    for (let f = 0; f < 3; f++) {
      const lines = Array.from({ length: 50 }, (_, i) => `match_${f}_${i}`).join('\n');
      await writeFile(join(workspace, `file${f}.ts`), lines);
    }
    const tool = createGrepTool(deps);
    const result = await tool.execute({ pattern: 'match_' });
    expect(result).toContain('file0.ts:');
    expect(result).toContain('file1.ts:');
    expect(result).not.toContain('file2.ts:'); // truncated after 100
    const matchCount = (result.match(/Line \d+:/g) || []).length;
    expect(matchCount).toBeLessThanOrEqual(100);
  });

  // ─── SEC1: end-to-end command injection guards ─────────────
  // These prove against the REAL host shell that shell metacharacters in the
  // pattern cannot achieve command execution. The unit-level contract guard
  // (workspace-deps-exec.test.ts) asserts execFile is used; these prove the
  // end-to-end effect: no side-effect file is ever created.

  it('SEC1: does not execute $() shell substitution in pattern', async () => {
    const sentinel = join(workspace, 'INJECTED_BY_SHELL');
    await writeFile(join(workspace, 'a.ts'), 'no relevant content here');
    const tool = createGrepTool(deps);
    await tool.execute({ pattern: `x$(touch ${sentinel})y` });
    expect(existsSync(sentinel)).toBe(false);
  });

  it('SEC1: does not execute backtick shell substitution in pattern', async () => {
    const sentinel = join(workspace, 'INJECTED_BY_BACKTICK');
    await writeFile(join(workspace, 'a.ts'), 'no relevant content here');
    const tool = createGrepTool(deps);
    await tool.execute({ pattern: 'x`touch ' + sentinel + '`y' });
    expect(existsSync(sentinel)).toBe(false);
  });

  it('SEC1: does not split pattern on semicolon into shell statements', async () => {
    const sentinel = join(workspace, 'INJECTED_BY_SEMICOLON');
    await writeFile(join(workspace, 'a.ts'), 'no relevant content here');
    const tool = createGrepTool(deps);
    await tool.execute({ pattern: `foo; touch ${sentinel}` });
    expect(existsSync(sentinel)).toBe(false);
  });
});
