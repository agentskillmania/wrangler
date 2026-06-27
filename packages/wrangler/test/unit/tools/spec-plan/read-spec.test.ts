import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../../../src/spec-plan/spec-store.js';
import { createReadSpecTool } from '../../../../src/tools/spec-plan/read-spec.js';
import { z } from 'zod';

describe('read_spec tool', () => {
  let testDir: string;
  let store: SpecStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `read-spec-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new SpecStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createReadSpecTool(store);
    expect(tool.name).toBe('read_spec');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths ---

  it('reads latest version when version is omitted', async () => {
    await store.save({
      meta: {
        name: 'test-spec',
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body v1',
    });
    await store.save({
      meta: {
        name: 'test-spec',
        version: 2,
        status: 'draft',
        workspacePath: '/test',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      body: 'body v2',
    });

    const tool = createReadSpecTool(store);
    const result = await tool.execute({ name: 'test-spec' });

    expect(result).toContain('body v2');
    expect(result).not.toContain('body v1');
  });

  it('reads specific version when version is provided', async () => {
    await store.save({
      meta: {
        name: 'test-spec',
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body v1',
    });
    await store.save({
      meta: {
        name: 'test-spec',
        version: 2,
        status: 'approved',
        workspacePath: '/test',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      body: 'body v2',
    });

    const tool = createReadSpecTool(store);
    const result = await tool.execute({ name: 'test-spec', version: 1 });

    expect(result).toContain('body v1');
  });

  it('returns formatted spec content with metadata', async () => {
    await store.save({
      meta: {
        name: 'formatted',
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: '# Spec Title\n\nContent here.',
    });

    const tool = createReadSpecTool(store);
    const result = await tool.execute({ name: 'formatted' });

    expect(result).toContain('# Spec Title');
    expect(result).toContain('formatted'); // meta name included
  });

  // --- Negative paths ---

  it('returns error message when spec not found', async () => {
    const tool = createReadSpecTool(store);
    const result = await tool.execute({ name: 'nonexistent' });
    expect(result).toContain('not found');
  });

  it('returns error when specific version not found', async () => {
    await store.save({
      meta: {
        name: 'test',
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body',
    });

    const tool = createReadSpecTool(store);
    const result = await tool.execute({ name: 'test', version: 99 });
    expect(result).toContain('not found');
  });

  it('rejects missing name via Zod schema', () => {
    const tool = createReadSpecTool(store);
    const result = tool.parameters.safeParse({});
    expect(result.success).toBe(false);
  });
});
