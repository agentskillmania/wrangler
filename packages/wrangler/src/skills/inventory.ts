/**
 * @fileoverview Skill file inventory rules — the wrangler-side mirror of
 * Rust `crates/wrangler/src/skills.rs` (split_inventory) and
 * `crates/wrangler/src/skills/fs.rs` (collect_relative_files).
 *
 * Rust keeps BOTH the collection walk and the partition/cap in the wrangler
 * crate (colts owns only the trait + manifest type); the TS mirror therefore
 * also lives here, applied on top of the injected colts provider (see
 * ./inventory-provider.ts). Rules shared by every inventory consumer
 * (load_skill delivery, /skill: injection, error self-heal):
 * recursive collection, junk pruning, deterministic sort, INVENTORY_CAP
 * truncation with an "...and N more" tail, and a document-blacklist
 * partition so a file is listed on exactly one side.
 * (R2P-114w, aligned with Rust dc5cb1f.)
 */

import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';

/** Maximum number of entries listed per inventory side (resources/scripts). */
export const INVENTORY_CAP = 50;

/**
 * Walk depth cap: the standard skill layout (SKILL.md + scripts/,
 * reference/) is two or three levels; anything past 8 is anomalous and gets
 * truncated with a warning (directory-bomb guard).
 */
const WALK_MAX_DEPTH = 8;

/**
 * Entry cap per skill: the truncation point for runaway inventories (the
 * INVENTORY_CAP above only shapes what is DISPLAYED, not how much is walked).
 */
const WALK_MAX_ENTRIES = 1000;

const SKILL_FILE = 'SKILL.md';

/**
 * Whether a directory entry is junk with no navigation value for the model.
 *
 * Dot-prefixed hidden entries (.git/.DS_Store/.idea…), dependency and build
 * artifact directories (node_modules/__pycache__/target), and *.pyc compiled
 * output never enter the inventory.
 */
export function isJunkEntry(name: string): boolean {
  return (
    name.startsWith('.') ||
    name === 'node_modules' ||
    name === '__pycache__' ||
    name === 'target' ||
    name.endsWith('.pyc')
  );
}

/** Document/data extensions — everything else is treated as an executable script. */
const DOC_EXTS = new Set([
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
]);

/**
 * Whether a file is a pure document/data file (→ resources); otherwise it is
 * treated as an executable script (→ scripts).
 *
 * Uses a document BLACKLIST rather than a script-extension whitelist: script
 * languages cannot be enumerated exhaustively (.ps1/.cmd/.rb/extensionless…),
 * while misfiling an occasional document as a script is harmless — the
 * inventory is navigation only and run_skill_script does not validate
 * extensions when executing.
 */
export function isDocumentFile(path: string): boolean {
  const dot = path.lastIndexOf('.');
  // No extension (Makefile) or a dotfile basename → script side.
  if (dot <= 0 || dot === path.length - 1) {
    return false;
  }
  return DOC_EXTS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Partition a skill directory's relative file list into resources
 * (documents/data) and scripts (everything else), sorted, with
 * INVENTORY_CAP truncation.
 *
 * The inventory exists for navigation and error self-healing; listing a huge
 * directory wholesale only floods the context. On truncation a trailing
 * "...and N more" count line is appended — paths left unlisted remain
 * reachable from the SKILL.md body. Empty sides stay undefined (manifest
 * optionality preserved).
 */
export function splitInventory(paths: string[]): {
  resources?: string[];
  scripts?: string[];
} {
  const files = [...paths].sort();
  const resources: string[] = [];
  const scripts: string[] = [];
  for (const f of files) {
    if (isDocumentFile(f)) {
      resources.push(f);
    } else {
      scripts.push(f);
    }
  }
  const cap = (list: string[]): string[] | undefined => {
    if (list.length === 0) {
      return undefined;
    }
    if (list.length > INVENTORY_CAP) {
      const hidden = list.length - INVENTORY_CAP;
      list.length = INVENTORY_CAP;
      list.push(`...and ${hidden} more`);
    }
    return list;
  };
  return { resources: cap(resources), scripts: cap(scripts) };
}

/**
 * Recursively collect the relative file paths (`/`-separated) under a skill
 * directory, pruning junk entries during traversal.
 *
 * The inventory must cover subdirectories (scripts/, reference/ are the
 * standard skill layouts) with relative paths — exactly the path shape
 * read_skill_resource / run_skill_script require. Two hard boundaries
 * (aligned with Rust 3ac6ac5): symlinks are NOT followed (lstat semantics —
 * a link is one file entry, its target never entered), and the walk is
 * capped at WALK_MAX_DEPTH / WALK_MAX_ENTRIES with a warning on truncation.
 * Unreadable subdirectories are skipped silently (Rust parity); an
 * unreadable ROOT throws so the caller can distinguish "not my backend"
 * from "empty".
 */
export async function collectRelativeFiles(absDir: string): Promise<string[]> {
  const out: string[] = [];
  await walk(absDir, '', out, 0);
  return out;
}

async function walk(absDir: string, rel: string, out: string[], depth: number): Promise<void> {
  if (depth > WALK_MAX_DEPTH) {
    console.warn(
      `[wrangler/skills] inventory walk hit depth cap ${WALK_MAX_DEPTH} at ${absDir} — truncated`
    );
    return;
  }
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch (err) {
    if (rel === '') {
      // Root unreadable — surface it (see doc above).
      throw err;
    }
    return;
  }
  for (const name of entries) {
    if (out.length >= WALK_MAX_ENTRIES) {
      console.warn(
        `[wrangler/skills] inventory walk hit entry cap ${WALK_MAX_ENTRIES} — truncated`
      );
      return;
    }
    if (isJunkEntry(name)) {
      continue;
    }
    const relChild = rel === '' ? name : `${rel}/${name}`;
    const absChild = join(absDir, name);
    try {
      // lstat (not stat): a symlink reports as itself, never as the
      // directory it points to. Following it (stat semantics) let a single
      // link to a home directory drag tens of thousands of files into the
      // inventory and reach outside the skill directory through the target;
      // the link itself is recorded as one plain file entry.
      if ((await lstat(absChild)).isDirectory()) {
        await walk(absChild, relChild, out, depth + 1);
      } else {
        out.push(relChild);
      }
    } catch {
      // Stat failed mid-walk — skip the entry.
    }
  }
}

/**
 * Build the enriched inventory entries for a skill directory: collect
 * recursively (junk pruned), drop SKILL.md itself (it is delivered as the
 * instructions, not listed as a resource), then partition/sort/cap.
 */
export async function buildSkillInventory(
  absDir: string
): Promise<{ resources?: string[]; scripts?: string[] }> {
  const files = await collectRelativeFiles(absDir);
  return splitInventory(files.filter((f) => f !== SKILL_FILE));
}
