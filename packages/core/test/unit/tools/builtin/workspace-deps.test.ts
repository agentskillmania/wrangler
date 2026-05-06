import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  resolvePath,
  truncateOutput,
  isBinaryFile,
} from '../../../../src/tools/builtin/workspace-deps.js';

describe('workspace-deps', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-test-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  const deps = () => ({ workspacePath: workspace });

  // --- resolvePath ---

  describe('resolvePath', () => {
    it('resolves relative path within workspace', () => {
      const result = resolvePath(deps(), 'src/index.ts');
      expect(result).toBe(join(workspace, 'src/index.ts'));
    });

    it('resolves absolute path within workspace', () => {
      const absPath = join(workspace, 'src/index.ts');
      const result = resolvePath(deps(), absPath);
      expect(result).toBe(absPath);
    });

    it('normalizes path with dots', () => {
      const result = resolvePath(deps(), 'src/../src/index.ts');
      expect(result).toBe(join(workspace, 'src/index.ts'));
    });

    it('rejects path traversal via ../../', () => {
      expect(() => resolvePath(deps(), '../../etc/passwd')).toThrow('Path traversal detected');
    });

    it('rejects absolute path outside workspace', () => {
      expect(() => resolvePath(deps(), '/etc/passwd')).toThrow('Path traversal detected');
    });

    it('rejects workspace sibling directory (prefix without separator)', () => {
      // /workspace-sibling should not match /workspace
      const sibling = workspace + '-sibling';
      expect(() => resolvePath(deps(), sibling)).toThrow('Path traversal detected');
    });
  });

  // --- truncateOutput ---

  describe('truncateOutput', () => {
    it('returns content as-is when under limit', () => {
      const { content, truncated } = truncateOutput('hello', 100);
      expect(content).toBe('hello');
      expect(truncated).toBe(false);
    });

    it('truncates when over limit and adds marker', () => {
      const longStr = 'a'.repeat(1000);
      const { content, truncated } = truncateOutput(longStr, 100);
      expect(truncated).toBe(true);
      expect(content).toContain('...[truncated]');
      expect(content.length).toBeLessThan(longStr.length);
    });

    it('does not split UTF-8 multi-byte characters', () => {
      // Each emoji is 4 bytes in UTF-8, 2 code units in JS string (surrogate pair)
      const emojis = '😀'.repeat(100); // 400 bytes
      const { content } = truncateOutput(emojis, 50); // marker is ~16 bytes, leaves ~34 bytes = 8 emojis
      expect(content).toContain('...[truncated]');
      const withoutMarker = content.replace('\n...[truncated]', '');
      // Should be whole emojis, not partial surrogate pairs
      expect(withoutMarker).toMatch(/^😀*$/u);
      expect(withoutMarker.length % 2).toBe(0); // each emoji is 2 code units
    });
  });

  // --- isBinaryFile ---

  describe('isBinaryFile', () => {
    it('detects binary by extension (.zip)', async () => {
      const path = join(workspace, 'test.zip');
      await writeFile(path, 'not actually zip');
      expect(await isBinaryFile(path)).toBe(true);
    });

    it('detects binary by extension (.exe)', async () => {
      const path = join(workspace, 'test.exe');
      await writeFile(path, 'content');
      expect(await isBinaryFile(path)).toBe(true);
    });

    it('detects binary by extension (.wasm)', async () => {
      const path = join(workspace, 'test.wasm');
      await writeFile(path, 'content');
      expect(await isBinaryFile(path)).toBe(true);
    });

    it('returns false for text extension (.ts)', async () => {
      const path = join(workspace, 'test.ts');
      await writeFile(path, 'const x = 1;');
      expect(await isBinaryFile(path)).toBe(false);
    });

    it('returns false for text extension (.json)', async () => {
      const path = join(workspace, 'test.json');
      await writeFile(path, '{}');
      expect(await isBinaryFile(path)).toBe(false);
    });

    it('returns false for text extension (.md)', async () => {
      const path = join(workspace, 'test.md');
      await writeFile(path, '# Hello');
      expect(await isBinaryFile(path)).toBe(false);
    });

    it('detects binary by byte sampling (>30% non-printable, no extension)', async () => {
      const path = join(workspace, 'binaryfile');
      // Create buffer with >30% non-printable bytes
      const buf = Buffer.alloc(100);
      for (let i = 0; i < 50; i++) buf[i] = 0; // 50% null bytes
      for (let i = 50; i < 100; i++) buf[i] = 65; // 'A'
      await writeFile(path, buf);
      expect(await isBinaryFile(path)).toBe(true);
    });

    it('returns false for empty file', async () => {
      const path = join(workspace, 'empty');
      await writeFile(path, '');
      expect(await isBinaryFile(path)).toBe(false);
    });
  });
});
