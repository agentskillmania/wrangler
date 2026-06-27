import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlanStore } from '../../../../src/spec-plan/plan-store.js';
import { createSavePlanTool } from '../../../../src/tools/spec-plan/save-plan.js';
import { z } from 'zod';

describe('save_plan tool', () => {
  let testDir: string;
  let store: PlanStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `save-plan-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new PlanStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createSavePlanTool(store);
    expect(tool.name).toBe('save_plan');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths: new plan ---

  it('creates a new plan with version 1', async () => {
    const tool = createSavePlanTool(store);
    const result = await tool.execute({
      name: 'my-plan',
      specVersion: 1,
      body: '# Plan\n\nTask 1',
    });

    expect(result).toContain('my-plan');
    expect(result).toContain('v1');

    const doc = await store.get('my-plan', 1, 1);
    expect(doc).not.toBeNull();
    expect(doc!.meta.status).toBe('draft');
    expect(doc!.meta.specVersion).toBe(1);
    expect(doc!.body).toBe('# Plan\n\nTask 1');
  });

  it('handles empty body', async () => {
    const tool = createSavePlanTool(store);
    const result = await tool.execute({ name: 'empty-plan', specVersion: 1, body: '' });
    expect(result).toContain('empty-plan');

    const doc = await store.get('empty-plan', 1, 1);
    expect(doc!.body).toBe('');
  });

  // --- Positive paths: overwrite draft ---

  it('overwrites existing draft instead of incrementing version', async () => {
    const tool = createSavePlanTool(store);

    await tool.execute({ name: 'my-plan', specVersion: 1, body: 'first draft' });
    const result = await tool.execute({ name: 'my-plan', specVersion: 1, body: 'updated' });

    expect(result).toContain('v1'); // still v1
    expect(result).toContain('updated'); // action is "updated"

    const doc = await store.get('my-plan', 1, 1);
    expect(doc!.meta.version).toBe(1);
    expect(doc!.meta.status).toBe('draft');
    expect(doc!.body).toBe('updated');

    // No v2 created
    const v2 = await store.get('my-plan', 1, 2);
    expect(v2).toBeNull();
  });

  it('increments version when overwriting approved plan (upgrade)', async () => {
    const tool = createSavePlanTool(store);

    await tool.execute({ name: 'my-plan', specVersion: 1, body: 'approved plan' });
    await store.updateStatus('my-plan', 1, 1, 'approved');

    const result = await tool.execute({ name: 'my-plan', specVersion: 1, body: 'v2 plan' });
    expect(result).toContain('v2');

    const v1 = await store.get('my-plan', 1, 1);
    const v2 = await store.get('my-plan', 1, 2);
    expect(v1!.meta.status).toBe('approved');
    expect(v1!.body).toBe('approved plan');
    expect(v2!.meta.status).toBe('draft');
    expect(v2!.body).toBe('v2 plan');
  });

  it('increments version when overwriting completed plan (upgrade)', async () => {
    const tool = createSavePlanTool(store);

    await tool.execute({ name: 'my-plan', specVersion: 1, body: 'old' });
    await store.updateStatus('my-plan', 1, 1, 'approved');
    await store.updateStatus('my-plan', 1, 1, 'executing');
    await store.updateStatus('my-plan', 1, 1, 'completed');

    const result = await tool.execute({ name: 'my-plan', specVersion: 1, body: 'new plan' });
    expect(result).toContain('v2');

    const v2 = await store.get('my-plan', 1, 2);
    expect(v2!.meta.status).toBe('draft');
  });

  it('different specVersions are independent scopes', async () => {
    const tool = createSavePlanTool(store);

    await tool.execute({ name: 'my-plan', specVersion: 1, body: 'for spec v1' });
    const result = await tool.execute({ name: 'my-plan', specVersion: 2, body: 'for spec v2' });

    expect(result).toContain('v1'); // new specVersion starts at v1

    const plan1 = await store.get('my-plan', 1, 1);
    const plan2 = await store.get('my-plan', 2, 1);
    expect(plan1).not.toBeNull();
    expect(plan2).not.toBeNull();
  });

  // --- Negative paths (≥30%) ---

  it('rejects missing name via Zod schema', () => {
    const tool = createSavePlanTool(store);
    const result = tool.parameters.safeParse({ specVersion: 1, body: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects missing specVersion via Zod schema', () => {
    const tool = createSavePlanTool(store);
    const result = tool.parameters.safeParse({ name: 'test', body: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects missing body via Zod schema', () => {
    const tool = createSavePlanTool(store);
    const result = tool.parameters.safeParse({ name: 'test', specVersion: 1 });
    expect(result.success).toBe(false);
  });
});
