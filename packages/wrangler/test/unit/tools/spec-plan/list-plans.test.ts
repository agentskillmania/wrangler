import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlanStore } from '../../../../src/spec-plan/plan-store.js';
import { createListPlansTool } from '../../../../src/tools/spec-plan/list-plans.js';
import { z } from 'zod';

describe('list_plans tool', () => {
  let testDir: string;
  let store: PlanStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `list-plans-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new PlanStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createListPlansTool(store);
    expect(tool.name).toBe('list_plans');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths ---

  it('returns empty list when no plans exist', async () => {
    const tool = createListPlansTool(store);
    const result = await tool.execute({});
    expect(result).toContain('No plans found');
  });

  it('lists all plans', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await store.save({
      meta: {
        name: 'plan-a',
        specName: 'spec-a',
        specVersion: 1,
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
        name: 'plan-b',
        specName: 'spec-b',
        specVersion: 2,
        version: 2,
        status: 'approved',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'body b',
    });

    const tool = createListPlansTool(store);
    const result = await tool.execute({});

    expect(result).toContain('plan-a');
    expect(result).toContain('plan-b');
    expect(result).toContain('spec-a');
    expect(result).toContain('spec-b');
    expect(result).toContain('draft');
    expect(result).toContain('approved');
  });

  it('filters by specName when provided', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await store.save({
      meta: {
        name: 'plan-x',
        specName: 'spec-x',
        specVersion: 1,
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'x',
    });
    await store.save({
      meta: {
        name: 'plan-y',
        specName: 'spec-y',
        specVersion: 1,
        version: 1,
        status: 'draft',
        workspacePath: '/test',
        createdAt: now,
        updatedAt: now,
      },
      body: 'y',
    });

    const tool = createListPlansTool(store);
    const result = await tool.execute({ specName: 'spec-x' });

    expect(result).toContain('plan-x');
    expect(result).not.toContain('plan-y');
  });

  // --- Negative paths ---

  it('returns no plans message for non-existent specName filter', async () => {
    const tool = createListPlansTool(store);
    const result = await tool.execute({ specName: 'nonexistent' });
    expect(result).toContain('No plans found');
  });

  it('accepts empty params', async () => {
    const tool = createListPlansTool(store);
    const result = await tool.execute({});
    expect(typeof result).toBe('string');
  });
});
