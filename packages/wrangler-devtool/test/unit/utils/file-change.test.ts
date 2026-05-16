import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyChanges } from '../../../src/utils/file-change.js';
import { CliError } from '../../../src/cli/options.js';

describe('applyChanges', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wrangler-devtool-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create a file', async () => {
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'create', new: 'hello' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(true);
    expect(readFileSync(join(tempDir, 'test.txt'), 'utf-8')).toBe('hello');
  });

  it('should edit a file', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'old content', 'utf-8');
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'edit', old: 'old content', new: 'new content' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(true);
    expect(readFileSync(join(tempDir, 'test.txt'), 'utf-8')).toBe('new content');
  });

  it('should delete a file', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'content', 'utf-8');
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'delete' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(true);
    expect(existsSync(join(tempDir, 'test.txt'))).toBe(false);
  });

  it('should reject create if file exists', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'content', 'utf-8');
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'create', new: 'hello' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('should reject edit if old content does not match', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'actual content', 'utf-8');
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'edit', old: 'wrong content', new: 'new content' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain('Old content not found');
  });

  it('should reject edit if file does not exist', async () => {
    const result = await applyChanges(
      [{ file: 'missing.txt', type: 'edit', old: 'old', new: 'new' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should reject delete if file does not exist', async () => {
    const result = await applyChanges(
      [{ file: 'missing.txt', type: 'delete' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should support dry-run mode', async () => {
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'create', new: 'hello' }],
      { cwd: tempDir, dryRun: true }
    );
    expect(result.applied).toBe(false);
    expect(existsSync(join(tempDir, 'test.txt'))).toBe(false);
  });

  it('should reject path escape attempts', async () => {
    const result = await applyChanges(
      [{ file: '../escape.txt', type: 'create', new: 'hello' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain('escapes workspace');
  });

  it('should reject hidden files', async () => {
    const result = await applyChanges(
      [{ file: '.env', type: 'create', new: 'secret' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain('Hidden files');
  });

  it('should abort all changes if one fails', async () => {
    writeFileSync(join(tempDir, 'a.txt'), 'a', 'utf-8');
    const result = await applyChanges(
      [
        { file: 'missing.txt', type: 'edit', old: 'old', new: 'new' },
        { file: 'a.txt', type: 'delete' },
      ],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(existsSync(join(tempDir, 'a.txt'))).toBe(true);
  });

  it('should apply multiple changes atomically', async () => {
    writeFileSync(join(tempDir, 'a.txt'), 'old a', 'utf-8');
    const result = await applyChanges(
      [
        { file: 'a.txt', type: 'edit', old: 'old a', new: 'new a' },
        { file: 'b.txt', type: 'create', new: 'new b' },
      ],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(true);
    expect(readFileSync(join(tempDir, 'a.txt'), 'utf-8')).toBe('new a');
    expect(readFileSync(join(tempDir, 'b.txt'), 'utf-8')).toBe('new b');
  });

  it('should edit with partial match in multi-line content', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'line1\nline2\nline3', 'utf-8');
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'edit', old: 'line2', new: 'line1\nreplaced\nline3' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(true);
    expect(readFileSync(join(tempDir, 'test.txt'), 'utf-8')).toBe('line1\nreplaced\nline3');
  });

  it('should reject create without new content', async () => {
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'create' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain("Create requires 'new' content");
  });

  it('should reject edit without old content', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'content', 'utf-8');
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'edit', new: 'new' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain("Edit requires both 'old' and 'new'");
  });

  it('should reject edit without new content', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'content', 'utf-8');
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'edit', old: 'content' }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain("Edit requires both 'old' and 'new'");
  });

  it('should reject unknown change type', async () => {
    const result = await applyChanges(
      [{ file: 'test.txt', type: 'unknown' as any }],
      { cwd: tempDir }
    );
    expect(result.applied).toBe(false);
    expect(result.error).toContain('Unknown change type');
  });
});
