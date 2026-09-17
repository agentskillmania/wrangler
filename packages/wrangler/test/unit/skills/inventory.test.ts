/**
 * Inventory collection rules — the wrangler-side mirror of Rust
 * `crates/wrangler/src/skills.rs` (split_inventory) + `skills/fs.rs`
 * (collect_relative_files), as landed in Rust commit dc5cb1f:
 * recursive collection, junk pruning, deterministic sort, INVENTORY_CAP
 * truncation with an "...and N more" tail, and the document-blacklist
 * partition (no double listing between resources and scripts).
 * (R2P-114w, aligned with Rust dc5cb1f.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  INVENTORY_CAP,
  isJunkEntry,
  isDocumentFile,
  splitInventory,
  collectRelativeFiles,
} from '../../../src/skills/inventory.js';

describe('isJunkEntry', () => {
  it.each(['.git', '.DS_Store', '.idea', 'node_modules', '__pycache__', 'target', 'x.pyc'])(
    "'%s' is junk (pruned from the inventory)",
    (name) => {
      expect(isJunkEntry(name)).toBe(true);
    }
  );

  it('normal entries are not junk', () => {
    expect(isJunkEntry('scripts')).toBe(false);
    expect(isJunkEntry('reference.md')).toBe(false);
    expect(isJunkEntry('src')).toBe(false);
  });
});

describe('isDocumentFile', () => {
  // DOC_EXTS 全表钉扎（17 项）：删任一扩展名（如 'pdf'）必须红——半表
  // 钉扎时删表尾项的变异存活。
  it.each([
    'md',
    'markdown',
    'txt',
    'json',
    'yaml',
    'yml',
    'toml',
    'csv',
    'tsv',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'webp',
    'pdf',
    'ico',
  ])("'%s' files go to resources (full DOC_EXTS table pin)", (ext) => {
    expect(isDocumentFile(`a/b/file.${ext}`)).toBe(true);
  });

  it('extension match is case-insensitive', () => {
    expect(isDocumentFile('IMG.PNG')).toBe(true);
    expect(isDocumentFile('Doc.MD')).toBe(true);
  });

  it('executables and unknown extensions go to scripts (blacklist, not whitelist)', () => {
    expect(isDocumentFile('scripts/generate.js')).toBe(false);
    expect(isDocumentFile('run.ps1')).toBe(false);
    expect(isDocumentFile('run.rb')).toBe(false);
    // No extension → script side: misfiling a rare document is harmless
    // (the inventory is navigation only), missing a script is not.
    expect(isDocumentFile('Makefile')).toBe(false);
  });
});

describe('splitInventory', () => {
  it('partitions documents vs scripts and sorts deterministically', () => {
    const { resources, scripts } = splitInventory(['b.md', 'run.js', 'a.md']);
    expect(resources).toEqual(['a.md', 'b.md']);
    expect(scripts).toEqual(['run.js']);
  });

  it('lists a file on exactly one side (no scripts double-listing)', () => {
    const { resources, scripts } = splitInventory(['a.md', 'b.js', 'c.ts', 'd.mjs', 'run.py']);
    expect(resources).toEqual(['a.md']);
    expect(scripts).toEqual(['b.js', 'c.ts', 'd.mjs', 'run.py']);
  });

  it('truncates at INVENTORY_CAP with an "...and N more" tail', () => {
    const many = Array.from({ length: 60 }, (_, i) => `doc${String(i).padStart(2, '0')}.md`);
    const { resources } = splitInventory(many);
    expect(resources).toHaveLength(INVENTORY_CAP + 1);
    expect(resources![INVENTORY_CAP]).toBe('...and 10 more');
    // The kept head is the sorted first CAP entries.
    expect(resources!.slice(0, INVENTORY_CAP)).toEqual(
      many.slice(0, INVENTORY_CAP).map((m) => m.replace(/^doc/, 'doc'))
    );
  });

  it('caps the scripts side independently', () => {
    const many = Array.from({ length: 55 }, (_, i) => `s${String(i).padStart(2, '0')}.sh`);
    const { scripts } = splitInventory(many);
    expect(scripts).toHaveLength(INVENTORY_CAP + 1);
    expect(scripts![INVENTORY_CAP]).toBe('...and 5 more');
  });

  it('empty input yields no inventory on either side', () => {
    const { resources, scripts } = splitInventory([]);
    expect(resources).toBeUndefined();
    expect(scripts).toBeUndefined();
  });
});

describe('collectRelativeFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = join(
      tmpdir(),
      `wrangler-test-inventory-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(join(root, 'reference', 'deep'), { recursive: true });
    await mkdir(join(root, 'scripts'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it('recurses into subdirectories with /-separated relative paths', async () => {
    await writeFile(join(root, 'SKILL.md'), '---\nname: x\n---\nbody');
    await writeFile(join(root, 'reference.md'), 'doc');
    await writeFile(join(root, 'reference', 'catalog.md'), 'doc');
    await writeFile(join(root, 'reference', 'deep', 'nested.json'), '{}');
    await writeFile(join(root, 'scripts', 'run.js'), 'code');

    const files = await collectRelativeFiles(root);
    expect(files.sort()).toEqual([
      'SKILL.md',
      'reference.md',
      'reference/catalog.md',
      'reference/deep/nested.json',
      'scripts/run.js',
    ]);
  });

  it('prunes junk entries during traversal', async () => {
    await writeFile(join(root, 'reference.md'), 'doc');
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, '.git', 'config'), '');
    await writeFile(join(root, '.DS_Store'), '');
    await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), '');
    await mkdir(join(root, '__pycache__'), { recursive: true });
    await writeFile(join(root, '__pycache__', 'm.pyc'), '');
    await mkdir(join(root, 'target'), { recursive: true });
    await writeFile(join(root, 'target', 'bin'), '');

    const files = await collectRelativeFiles(root);
    expect(files).toEqual(['reference.md']);
  });

  it('throws when the root directory cannot be read', async () => {
    await expect(collectRelativeFiles(join(root, 'does-not-exist'))).rejects.toThrow();
  });
});
