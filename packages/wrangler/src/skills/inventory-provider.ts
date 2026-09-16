/**
 * @fileoverview Inventory-aligning skill provider wrapper.
 *
 * The TS stack's collection currently lives in colts
 * (FilesystemSkillProvider.collectFiles: top-level scan, no junk pruning,
 * no sort/cap, and scripts double-listed), while every consumer
 * (load_skill delivery, /skill: injection, read_skill_resource /
 * run_skill_script self-heal, the skills catalog) lives in wrangler. In the
 * Rust layout both the walk (skills/fs.rs) and the partition/cap
 * (skills.rs split_inventory) belong to the wrangler crate — colts only
 * owns the trait and the manifest type. This wrapper restores that
 * division without touching colts: it delegates discovery/instruction/
 * resource loading to the inner provider and re-derives each manifest's
 * resources/scripts with the Rust-aligned rules from ./inventory.js.
 * (R2P-114w, aligned with Rust dc5cb1f.)
 *
 * Handoff (next colts alpha): once colts's own FilesystemSkillProvider
 * implements the four collection items (recursive walk, junk pruning,
 * deterministic sort, INVENTORY_CAP + "...and N more" tail) and stops
 * double-listing scripts, this wrapper becomes a pass-through and can be
 * retired.
 */

import type { ISkillProvider, SkillManifest } from '@agentskillmania/colts';

import { buildSkillInventory } from './inventory.js';

/** Walker contract — overridable for tests. */
export type SkillDirWalker = (
  absDir: string
) => Promise<{ resources?: string[]; scripts?: string[] }>;

export interface InventorySkillProviderOptions {
  /** Directory walker — defaults to the Rust-aligned buildSkillInventory. */
  walk?: SkillDirWalker;
}

interface CachedInventory {
  /** Source the cache entry was computed from (name → source remaps re-walk). */
  source: string;
  resources?: string[];
  scripts?: string[];
}

/**
 * Wraps an injected ISkillProvider so every manifest it hands out carries
 * the Rust-aligned file inventory.
 *
 * Backends whose `source` is not a readable directory on this host (browser
 * OPFS-backed providers, embedded trees) keep the inner manifest verbatim —
 * enrichment is strictly additive when it can run. Results are cached per
 * skill (re-walked when the manifest source changes or after refresh()),
 * so the per-request skills catalog stays a Map lookup after the first walk.
 */
export class InventorySkillProvider implements ISkillProvider {
  private readonly inner: ISkillProvider;
  private readonly walk: SkillDirWalker;
  private readonly cache = new Map<string, CachedInventory>();

  constructor(inner: ISkillProvider, options?: InventorySkillProviderOptions) {
    this.inner = inner;
    this.walk = options?.walk ?? buildSkillInventory;
  }

  async getManifest(name: string): Promise<SkillManifest | undefined> {
    const manifest = await this.inner.getManifest(name);
    return manifest ? this.enrich(manifest) : undefined;
  }

  loadInstructions(name: string): Promise<string> {
    return this.inner.loadInstructions(name);
  }

  loadResource(name: string, relativePath: string): Promise<string> {
    return this.inner.loadResource(name, relativePath);
  }

  async listSkills(): Promise<SkillManifest[]> {
    const all = await this.inner.listSkills();
    return Promise.all(all.map((m) => this.enrich(m)));
  }

  async refresh(): Promise<void> {
    this.cache.clear();
    await this.inner.refresh();
  }

  private async enrich(manifest: SkillManifest): Promise<SkillManifest> {
    if (!manifest.source) {
      return manifest;
    }
    const cached = this.cache.get(manifest.name);
    if (cached && cached.source === manifest.source) {
      return { ...manifest, resources: cached.resources, scripts: cached.scripts };
    }
    let inventory: { resources?: string[]; scripts?: string[] };
    try {
      inventory = await this.walk(manifest.source);
    } catch {
      // Source not readable through this host's fs (browser/embedded
      // backends) — keep the inner manifest's inventory verbatim.
      return manifest;
    }
    this.cache.set(manifest.name, {
      source: manifest.source,
      resources: inventory.resources,
      scripts: inventory.scripts,
    });
    return { ...manifest, resources: inventory.resources, scripts: inventory.scripts };
  }
}
