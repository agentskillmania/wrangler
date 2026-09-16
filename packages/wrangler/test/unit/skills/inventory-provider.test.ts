/**
 * InventorySkillProvider — the wrangler-side inventory fix.
 *
 * Collection lives in colts (FilesystemSkillProvider.collectFiles:
 * top-level scan, no pruning, no cap, scripts double-listed) while every
 * consumer lives here — the Rust layout keeps collection (fs.rs) AND
 * partition/cap (skills.rs split_inventory) in the wrangler crate, so the
 * TS mirror wraps the injected provider and re-derives each manifest's
 * resources/scripts with the Rust-aligned rules.
 * (R2P-114w, aligned with Rust dc5cb1f.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { FilesystemSkillProvider, setDefaultSkillFsOps } from '@agentskillmania/colts';
import { nodeFsOps } from '@agentskillmania/colts/skills/node-fs-ops';

import { InventorySkillProvider } from '../../../src/skills/inventory-provider.js';

setDefaultSkillFsOps(nodeFsOps);

const SKILL_MD = '---\nname: demo\ndescription: Demo skill\n---\n\nDemo body.\n';

describe('InventorySkillProvider', () => {
  let skillsDir: string;
  let skillDir: string;

  beforeEach(async () => {
    skillsDir = join(
      tmpdir(),
      `wrangler-test-invprov-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    skillDir = join(skillsDir, 'demo');
    await mkdir(join(skillDir, 'reference', 'deep'), { recursive: true });
    await mkdir(join(skillDir, 'scripts'), { recursive: true });
    await mkdir(join(skillDir, 'node_modules', 'dep'), { recursive: true });
    await mkdir(join(skillDir, '.git'), { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), SKILL_MD);
    await writeFile(join(skillDir, 'reference.md'), 'doc');
    await writeFile(join(skillDir, 'reference', 'catalog.md'), 'doc');
    await writeFile(join(skillDir, 'reference', 'deep', 'nested.json'), '{}');
    await writeFile(join(skillDir, 'scripts', 'run.js'), 'code');
    await writeFile(join(skillDir, 'scripts', 'util.py'), 'code');
    await writeFile(join(skillDir, '.git', 'config'), '');
    await writeFile(join(skillDir, 'node_modules', 'dep', 'index.js'), '');
  });

  afterEach(async () => {
    await rm(skillsDir, { recursive: true, force: true }).catch(() => {});
  });

  function makeWrapped(walk?: (dir: string) => Promise<string[]>) {
    const inner = new FilesystemSkillProvider([skillsDir]);
    const provider = new InventorySkillProvider(inner, walk ? { walk } : undefined);
    return { inner, provider };
  }

  it('re-derives the inventory recursively, pruned, sorted, and partitioned', async () => {
    const { provider } = makeWrapped();
    const manifest = await provider.getManifest('demo');
    expect(manifest?.resources).toEqual([
      'reference.md',
      'reference/catalog.md',
      'reference/deep/nested.json',
    ]);
    expect(manifest?.scripts).toEqual(['scripts/run.js', 'scripts/util.py']);
  });

  it('fixes the scripts double-listing from the legacy inner scan', async () => {
    // Legacy collectFiles scans top-level only and double-lists top-level
    // scripts (in resources via the != SKILL.md filter AND in scripts via
    // the .js/.ts/.mjs filter).
    await writeFile(join(skillDir, 'top.js'), 'code');
    const { inner } = makeWrapped();
    const legacy = await inner.getManifest('demo');
    expect(legacy?.resources).toContain('top.js');
    expect(legacy?.scripts).toContain('top.js');
    // Nested paths never enter the legacy inventory at all.
    expect(legacy?.scripts).not.toContain('scripts/run.js');

    const { provider } = makeWrapped();
    const manifest = await provider.getManifest('demo');
    expect(manifest?.resources).not.toContain('top.js');
    expect(manifest?.scripts).toEqual(['scripts/run.js', 'scripts/util.py', 'top.js']);
  });

  it('preserves name/description/source and delegates instructions/resources', async () => {
    const { provider } = makeWrapped();
    const manifest = await provider.getManifest('demo');
    expect(manifest?.name).toBe('demo');
    expect(manifest?.description).toBe('Demo skill');
    expect(manifest?.source).toBe(skillDir);

    await expect(provider.loadInstructions('demo')).resolves.toBe('\nDemo body.\n');
    await expect(provider.loadResource('demo', 'reference.md')).resolves.toBe('doc');
  });

  it('enriches every manifest from listSkills (order preserved)', async () => {
    const { provider } = makeWrapped();
    const all = await provider.listSkills();
    expect(all).toHaveLength(1);
    expect(all[0]?.scripts).toEqual(['scripts/run.js', 'scripts/util.py']);
  });

  it('walks each skill directory once and caches until refresh', async () => {
    const walk = vi.fn(async () => ['a.md']);
    const { provider } = makeWrapped(walk);
    await provider.getManifest('demo');
    await provider.getManifest('demo');
    await provider.listSkills();
    expect(walk).toHaveBeenCalledTimes(1);

    await provider.refresh();
    await provider.getManifest('demo');
    expect(walk).toHaveBeenCalledTimes(2);
  });

  it('keeps the inner manifest untouched when the source is unreadable (browser providers)', async () => {
    const inner = {
      getManifest: vi.fn().mockResolvedValue({
        name: 'bundled',
        description: 'Bundled',
        source: '/opfs-not-a-real-disk-path/skills/bundled',
        resources: ['legacy.md'],
        scripts: ['legacy.js'],
      }),
      loadInstructions: vi.fn().mockResolvedValue('body'),
      loadResource: vi.fn().mockResolvedValue('content'),
      listSkills: vi.fn().mockResolvedValue([
        {
          name: 'bundled',
          description: 'Bundled',
          source: '/opfs-not-a-real-disk-path/skills/bundled',
          resources: ['legacy.md'],
          scripts: ['legacy.js'],
        },
      ]),
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    const provider = new InventorySkillProvider(inner);
    const manifest = await provider.getManifest('bundled');
    expect(manifest?.resources).toEqual(['legacy.md']);
    expect(manifest?.scripts).toEqual(['legacy.js']);
  });

  it('returns undefined for unknown skills', async () => {
    const { provider } = makeWrapped();
    await expect(provider.getManifest('nope')).resolves.toBeUndefined();
  });
});
