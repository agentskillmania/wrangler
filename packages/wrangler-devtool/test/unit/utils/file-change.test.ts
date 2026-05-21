import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { applyChanges, type FileChange } from '../../../src/utils/file-change.js';

describe('applyChanges', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `fc-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a new file', async () => {
    const changes: FileChange[] = [{ file: 'new.txt', type: 'create', new: 'hello' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(true);
    const content = await readFile(join(tempDir, 'new.txt'), 'utf-8');
    expect(content).toBe('hello');
  });

  it('edits an existing file', async () => {
    await writeFile(join(tempDir, 'edit.txt'), 'old content', 'utf-8');
    const changes: FileChange[] = [
      { file: 'edit.txt', type: 'edit', old: 'old content', new: 'new content' },
    ];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(true);
    const content = await readFile(join(tempDir, 'edit.txt'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('deletes a file', async () => {
    const target = join(tempDir, 'del.txt');
    await writeFile(target, 'bye', 'utf-8');
    const changes: FileChange[] = [{ file: 'del.txt', type: 'delete' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(true);
    await expect(access(target)).rejects.toThrow();
  });

  it('rejects path escape via ../', async () => {
    const changes: FileChange[] = [{ file: '../escaped.txt', type: 'create', new: 'x' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('escapes workspace');
  });

  it('rejects path escape via nested ../', async () => {
    const changes: FileChange[] = [{ file: 'a/../../escaped.txt', type: 'create', new: 'x' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('escapes workspace');
  });

  it('allows dot-prefixed filenames like .eslintrc.js', async () => {
    const changes: FileChange[] = [
      { file: '.eslintrc.js', type: 'create', new: 'module.exports = {};' },
    ];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(true);
    const content = await readFile(join(tempDir, '.eslintrc.js'), 'utf-8');
    expect(content).toBe('module.exports = {};');
  });

  it('applies multiple changes atomically', async () => {
    await writeFile(join(tempDir, 'multi.txt'), 'original', 'utf-8');
    const changes: FileChange[] = [
      { file: 'multi.txt', type: 'edit', old: 'original', new: 'updated' },
      { file: 'extra.txt', type: 'create', new: 'extra' },
    ];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(true);
    expect(await readFile(join(tempDir, 'multi.txt'), 'utf-8')).toBe('updated');
    expect(await readFile(join(tempDir, 'extra.txt'), 'utf-8')).toBe('extra');
  });

  it('rejects all changes if any one is invalid', async () => {
    await writeFile(join(tempDir, 'valid.txt'), 'v', 'utf-8');
    const changes: FileChange[] = [
      { file: 'valid.txt', type: 'edit', old: 'v', new: 'V' },
      { file: '../invalid.txt', type: 'create', new: 'x' },
    ];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    // valid.txt should NOT be modified
    expect(await readFile(join(tempDir, 'valid.txt'), 'utf-8')).toBe('v');
  });

  it('dryRun mode validates but does not write', async () => {
    const changes: FileChange[] = [{ file: 'dry.txt', type: 'create', new: 'dry' }];
    const result = await applyChanges(changes, { cwd: tempDir, dryRun: true });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('Dry run');
    await expect(access(join(tempDir, 'dry.txt'))).rejects.toThrow();
  });
});
