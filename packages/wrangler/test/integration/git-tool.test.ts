/**
 * @fileoverview Integration test: git tool user story.
 *
 * User story: As a developer agent, I want to run git subcommands in the
 * workspace so that I can inspect and manage version control state.
 *
 * Layer: INTEGRATION — uses a real HostToolDeps, real filesystem, and the real
 * git binary. No mocks. Validates end-to-end that the git tool correctly
 * parses commands into argv and runs them via execArray (the SEC3 fix path).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGitTool } from '../../src/tools/builtin/git.js';
import { HostToolDeps } from '../../src/tools/builtin/workspace-deps.js';

describe('Integration: git tool (real git)', () => {
  let workspace: string;
  let deps: HostToolDeps;

  beforeEach(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'wrangler-int-git-'));
    deps = new HostToolDeps(workspace);
    // Initialize a real git repo for the tests
    await deps.exec('git init');
    await deps.exec('git config user.email test@test.com');
    await deps.exec('git config user.name Test');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('runs "git status" in an initialized repo', async () => {
    const tool = createGitTool(deps);
    const result = await tool.execute({ command: 'status' });
    expect(result).toContain('On branch');
  });

  it('runs "git log --oneline" on a fresh repo (handles empty history)', async () => {
    const tool = createGitTool(deps);
    const result = await tool.execute({ command: 'log --oneline' });
    // Fresh repo has no commits — git returns non-zero, tool formats the error
    expect(typeof result).toBe('string');
  });

  it('runs "git add" + "git commit" with a quoted message', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(workspace, 'a.txt'), 'hello\n');
    const tool = createGitTool(deps);
    await tool.execute({ command: 'add a.txt' });
    const commitResult = await tool.execute({
      command: 'commit -m "first commit"',
    });
    // Commit should succeed (exit 0) — message preserved as single argv element
    expect(commitResult).not.toContain('Exit code');
  });

  it('returns "(no output)" for commands that produce no stdout on success', async () => {
    const tool = createGitTool(deps);
    const result = await tool.execute({ command: 'add -A' });
    expect(result).toBe('(no output)');
  });
});
