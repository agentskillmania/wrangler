import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlanStore } from '../../../../src/spec-plan/plan-store.js';
import { createUpdatePlanStatusTool } from '../../../../src/tools/spec-plan/update-plan-status.js';
import { z } from 'zod';

describe('update_plan_status tool', () => {
  let testDir: string;
  let store: PlanStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `update-plan-status-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new PlanStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createUpdatePlanStatusTool(store);
    expect(tool.name).toBe('update_plan_status');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths ---

  it('updates status from draft to approved', async () => {
    await store.save({
      meta: {
        name: 'test',
        specName: 'test-spec',
        specVersion: 1,
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body',
    });

    const tool = createUpdatePlanStatusTool(store);
    const result = await tool.execute({
      name: 'test',
      specVersion: 1,
      version: 1,
      status: 'approved',
    });

    expect(result).toContain('approved');

    const doc = await store.get('test', 1, 1);
    expect(doc!.meta.status).toBe('approved');
  });

  it('updates status from approved to executing', async () => {
    await store.save({
      meta: {
        name: 'test',
        specName: 'test-spec',
        specVersion: 1,
        version: 1,
        status: 'approved',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body',
    });

    const tool = createUpdatePlanStatusTool(store);
    const result = await tool.execute({
      name: 'test',
      specVersion: 1,
      version: 1,
      status: 'executing',
    });

    expect(result).toContain('executing');
  });

  it('updates status from executing to completed', async () => {
    await store.save({
      meta: {
        name: 'test',
        specName: 'test-spec',
        specVersion: 1,
        version: 1,
        status: 'executing',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body',
    });

    const tool = createUpdatePlanStatusTool(store);
    const result = await tool.execute({
      name: 'test',
      specVersion: 1,
      version: 1,
      status: 'completed',
    });

    expect(result).toContain('completed');
  });

  // --- Negative paths ---

  it('returns error for invalid status transition', async () => {
    await store.save({
      meta: {
        name: 'test',
        specName: 'test-spec',
        specVersion: 1,
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      body: 'body',
    });

    const tool = createUpdatePlanStatusTool(store);
    const result = await tool.execute({
      name: 'test',
      specVersion: 1,
      version: 1,
      status: 'executing',
    });

    expect(result).toContain('Error');
  });

  it('returns error when plan not found', async () => {
    const tool = createUpdatePlanStatusTool(store);
    const result = await tool.execute({
      name: 'nonexistent',
      specVersion: 1,
      version: 1,
      status: 'approved',
    });

    expect(result).toContain('Error');
  });

  it('rejects missing name via Zod schema', () => {
    const tool = createUpdatePlanStatusTool(store);
    const result = tool.parameters.safeParse({ specVersion: 1, version: 1, status: 'approved' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status via Zod schema', () => {
    const tool = createUpdatePlanStatusTool(store);
    const result = tool.parameters.safeParse({
      name: 'test',
      specVersion: 1,
      version: 1,
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});
