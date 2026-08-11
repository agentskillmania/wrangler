import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../../../src/spec-plan/spec-store.js';
import { createListSpecsTool } from '../../../../src/tools/spec-plan/list-specs.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';
import { z } from 'zod';

describe('list_specs tool', () => {
  let testDir: string;
  let store: SpecStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `list-specs-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new SpecStore(testDir, new NodeHostEnv());
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createListSpecsTool(store);
    expect(tool.name).toBe('list_specs');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths ---

  it('returns empty list when no specs exist', async () => {
    const tool = createListSpecsTool(store);
    const result = await tool.execute({});
    expect(result).toContain('No specs found');
  });

  it('lists all spec names and versions', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await store.save({
      meta: {
        name: 'spec-a',
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'body a',
    });
    await store.save({
      meta: {
        name: 'spec-b',
        version: 2,
        status: 'approved',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'body b',
    });

    const tool = createListSpecsTool(store);
    const result = await tool.execute({});

    expect(result).toContain('spec-a');
    expect(result).toContain('v1');
    expect(result).toContain('spec-b');
    expect(result).toContain('v2');
    expect(result).toContain('draft');
    expect(result).toContain('approved');
  });

  it('handles directory that does not exist', async () => {
    const tempDir = join(tmpdir(), `empty-list-${Date.now()}`);
    const emptyStore = new SpecStore(tempDir, new NodeHostEnv());
    const tool = createListSpecsTool(emptyStore);
    const result = await tool.execute({});
    expect(result).toContain('No specs found');
  });

  // --- Negative paths ---

  it('accepts empty params', async () => {
    const tool = createListSpecsTool(store);
    // No params needed, but the tool should still work
    const result = await tool.execute({});
    expect(typeof result).toBe('string');
  });
});
