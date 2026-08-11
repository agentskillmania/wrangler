import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../../../src/spec-plan/spec-store.js';
import { createUpdateSpecStatusTool } from '../../../../src/tools/spec-plan/update-spec-status.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';
import { z } from 'zod';

describe('update_spec_status tool', () => {
  let testDir: string;
  let store: SpecStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `update-spec-status-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new SpecStore(testDir, new NodeHostEnv());
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createUpdateSpecStatusTool(store);
    expect(tool.name).toBe('update_spec_status');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths ---

  it('updates status from draft to approved', async () => {
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

    const tool = createUpdateSpecStatusTool(store);
    const result = await tool.execute({ name: 'test', version: 1, status: 'approved' });

    expect(result).toContain('approved');

    const doc = await store.get('test', 1);
    expect(doc!.meta.status).toBe('approved');
  });

  it('updates status from approved to superseded', async () => {
    await store.save({
      meta: {
        name: 'test',
        version: 1,
        status: 'approved',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body',
    });

    const tool = createUpdateSpecStatusTool(store);
    const result = await tool.execute({ name: 'test', version: 1, status: 'superseded' });

    expect(result).toContain('superseded');
  });

  // --- Negative paths ---

  it('returns error for invalid status transition', async () => {
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

    const tool = createUpdateSpecStatusTool(store);
    const result = await tool.execute({ name: 'test', version: 1, status: 'completed' });

    expect(result).toContain('Error');
  });

  it('returns error when spec not found', async () => {
    const tool = createUpdateSpecStatusTool(store);
    const result = await tool.execute({ name: 'nonexistent', version: 1, status: 'approved' });

    expect(result).toContain('Error');
  });

  it('rejects missing name via Zod schema', () => {
    const tool = createUpdateSpecStatusTool(store);
    const result = tool.parameters.safeParse({ version: 1, status: 'approved' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status value via Zod schema', () => {
    const tool = createUpdateSpecStatusTool(store);
    const result = tool.parameters.safeParse({ name: 'test', version: 1, status: 'invalid' });
    expect(result.success).toBe(false);
  });
});
