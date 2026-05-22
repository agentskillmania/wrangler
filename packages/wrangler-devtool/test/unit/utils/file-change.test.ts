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

  it('rejects create when file already exists', async () => {
    await writeFile(join(tempDir, 'exists.txt'), 'original', 'utf-8');
    const changes: FileChange[] = [{ file: 'exists.txt', type: 'create', new: 'dup' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('already exists');
    expect(await readFile(join(tempDir, 'exists.txt'), 'utf-8')).toBe('original');
  });

  it('rejects edit when file does not exist', async () => {
    const changes: FileChange[] = [{ file: 'missing.txt', type: 'edit', old: 'x', new: 'y' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('rejects edit when old content not found', async () => {
    await writeFile(join(tempDir, 'edit2.txt'), 'hello world', 'utf-8');
    const changes: FileChange[] = [
      { file: 'edit2.txt', type: 'edit', old: 'not found', new: 'new' },
    ];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects delete when file does not exist', async () => {
    const changes: FileChange[] = [{ file: 'gone.txt', type: 'delete' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('rejects create without new content', async () => {
    const changes: FileChange[] = [{ file: 'no-content.txt', type: 'create' } as FileChange];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain("Create requires 'new'");
  });

  it('rejects edit without old or new content', async () => {
    await writeFile(join(tempDir, 'edit3.txt'), 'content', 'utf-8');
    const changes: FileChange[] = [{ file: 'edit3.txt', type: 'edit' } as FileChange];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain("Edit requires both 'old' and 'new'");
  });

  it('rejects . directory entry as already existing', async () => {
    const changes: FileChange[] = [{ file: '.', type: 'create', new: 'x' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
  });

  it('rejects .. directory entry as path escape', async () => {
    const changes: FileChange[] = [{ file: '..', type: 'create', new: 'x' }];
    const result = await applyChanges(changes, { cwd: tempDir });

    expect(result.applied).toBe(false);
    expect(result.error).toContain('escapes workspace');
  });
});
