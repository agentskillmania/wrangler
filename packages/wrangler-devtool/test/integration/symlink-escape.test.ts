/**
 * SEC11: symlink escape guard for applyChanges.
 * A symlink inside the workspace pointing outside must be rejected.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyChanges } from '../../src/utils/file-change.js';

describe('SEC11: symlink escape protection', () => {
  let workspace: string;
  let outside: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sec11-ws-'));
    outside = await mkdtemp(join(tmpdir(), 'sec11-out-'));
    await writeFile(join(outside, 'secret.txt'), 'TOPSECRET');
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('rejects edit via symlink pointing outside workspace', async () => {
    // Create a symlink inside workspace pointing to outside
    await symlink(outside, join(workspace, 'escape-link'));

    const result = await applyChanges(
      [{ file: 'escape-link/secret.txt', type: 'edit' as const, old: 'TOPSECRET', new: 'PWNED' }],
      { cwd: workspace }
    );

    expect(result.applied).toBe(false);
    // The secret file must NOT be modified
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(join(outside, 'secret.txt'), 'utf-8');
    expect(content).toBe('TOPSECRET');
  });

  it('allows normal edit within workspace (no false positive)', async () => {
    await writeFile(join(workspace, 'normal.txt'), 'hello');
    const result = await applyChanges(
      [{ file: 'normal.txt', type: 'edit' as const, old: 'hello', new: 'world' }],
      { cwd: workspace }
    );
    expect(result.applied).toBe(true);
  });
});
