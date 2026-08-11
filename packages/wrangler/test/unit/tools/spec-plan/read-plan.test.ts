import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlanStore } from '../../../../src/spec-plan/plan-store.js';
import { createReadPlanTool } from '../../../../src/tools/spec-plan/read-plan.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';
import { z } from 'zod';

describe('read_plan tool', () => {
  let testDir: string;
  let store: PlanStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `read-plan-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new PlanStore(testDir, new NodeHostEnv());
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createReadPlanTool(store);
    expect(tool.name).toBe('read_plan');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths ---

  it('reads latest plan version for a spec', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await store.save({
      meta: {
        name: 'my-plan',
        specName: 'my-spec',
        specVersion: 1,
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'plan v1',
    });
    await store.save({
      meta: {
        name: 'my-plan',
        specName: 'my-spec',
        specVersion: 1,
        version: 2,
        status: 'approved',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'plan v2',
    });

    const tool = createReadPlanTool(store);
    const result = await tool.execute({ name: 'my-plan' });

    expect(result).toContain('plan v2');
    expect(result).not.toContain('plan v1');
  });

  it('reads specific version when provided', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await store.save({
      meta: {
        name: 'my-plan',
        specName: 'my-spec',
        specVersion: 1,
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'plan v1',
    });
    await store.save({
      meta: {
        name: 'my-plan',
        specName: 'my-spec',
        specVersion: 1,
        version: 2,
        status: 'draft',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'plan v2',
    });

    const tool = createReadPlanTool(store);
    const result = await tool.execute({ name: 'my-plan', specVersion: 1, version: 1 });

    expect(result).toContain('plan v1');
  });

  // --- Negative paths ---

  it('returns error when plan not found', async () => {
    const tool = createReadPlanTool(store);
    const result = await tool.execute({ name: 'nonexistent' });
    expect(result).toContain('not found');
  });

  it('returns error when specific version not found', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await store.save({
      meta: {
        name: 'my-plan',
        specName: 'my-spec',
        specVersion: 1,
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'body',
    });

    const tool = createReadPlanTool(store);
    const result = await tool.execute({ name: 'my-plan', specVersion: 1, version: 99 });
    expect(result).toContain('not found');
  });

  it('rejects missing name via Zod schema', () => {
    const tool = createReadPlanTool(store);
    const result = tool.parameters.safeParse({});
    expect(result.success).toBe(false);
  });
});
