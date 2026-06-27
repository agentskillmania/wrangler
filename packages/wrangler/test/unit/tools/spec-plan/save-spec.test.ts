import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../../../src/spec-plan/spec-store.js';
import { createSaveSpecTool } from '../../../../src/tools/spec-plan/save-spec.js';
import { z } from 'zod';

describe('save_spec tool', () => {
  let testDir: string;
  let store: SpecStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `save-spec-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    store = new SpecStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // --- Metadata ---

  it('has correct metadata', () => {
    const tool = createSaveSpecTool(store);
    expect(tool.name).toBe('save_spec');
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  // --- Positive paths: new spec ---

  it('creates a new spec with version 1 when no previous spec exists', async () => {
    const tool = createSaveSpecTool(store);
    const before = await store.getLatest('my-feature');
    expect(before).toBeNull();

    const result = await tool.execute({
      name: 'my-feature',
      body: '# My Feature\n\nGoal: Test it.',
    });
    expect(result).toContain('my-feature');
    expect(result).toContain('v1');

    const after = await store.getLatest('my-feature');
    expect(after).not.toBeNull();
    expect(after!.meta.version).toBe(1);
    expect(after!.meta.status).toBe('draft');
    expect(after!.body).toBe('# My Feature\n\nGoal: Test it.');
  });

  it('handles empty body', async () => {
    const tool = createSaveSpecTool(store);
    const result = await tool.execute({ name: 'empty-spec', body: '' });
    expect(result).toContain('empty-spec');

    const doc = await store.getLatest('empty-spec');
    expect(doc!.body).toBe('');
  });

  it('handles name with special characters', async () => {
    const tool = createSaveSpecTool(store);
    const result = await tool.execute({ name: 'user-auth-flow_v2', body: 'body' });
    expect(result).toContain('user-auth-flow_v2');

    const doc = await store.getLatest('user-auth-flow_v2');
    expect(doc).not.toBeNull();
  });

  // --- Positive paths: overwrite draft (new behavior) ---

  it('overwrites existing draft instead of incrementing version', async () => {
    const tool = createSaveSpecTool(store);

    // First save creates v1(draft)
    await tool.execute({ name: 'my-feature', body: 'first draft' });
    const v1 = await store.get('my-feature', 1);
    expect(v1).not.toBeNull();
    expect(v1!.meta.status).toBe('draft');
    expect(v1!.body).toBe('first draft');

    // Second save — same name, still draft → overwrite v1, not v2
    const result = await tool.execute({ name: 'my-feature', body: 'updated draft' });
    expect(result).toContain('updated'); // "updated" not "saved"
    expect(result).toContain('v1'); // still v1

    const doc = await store.getLatest('my-feature');
    expect(doc!.meta.version).toBe(1);
    expect(doc!.meta.status).toBe('draft');
    expect(doc!.body).toBe('updated draft');

    // Verify no v2 was created
    const v2 = await store.get('my-feature', 2);
    expect(v2).toBeNull();
  });

  it('increments version when overwriting an approved spec (upgrade)', async () => {
    const tool = createSaveSpecTool(store);

    // Save v1 and approve it
    await tool.execute({ name: 'my-feature', body: 'approved spec' });
    await store.updateStatus('my-feature', 1, 'approved');

    // Now save again — should create v2(draft) because v1 is approved
    const result = await tool.execute({ name: 'my-feature', body: 'upgraded spec' });
    expect(result).toContain('v2');

    const v1 = await store.get('my-feature', 1);
    const v2 = await store.get('my-feature', 2);
    expect(v1!.meta.status).toBe('approved');
    expect(v1!.body).toBe('approved spec'); // preserved
    expect(v2!.meta.status).toBe('draft');
    expect(v2!.body).toBe('upgraded spec');
  });

  it('increments version when overwriting a superseded spec (upgrade)', async () => {
    const tool = createSaveSpecTool(store);

    await tool.execute({ name: 'my-feature', body: 'old' });
    await store.updateStatus('my-feature', 1, 'approved');
    await store.updateStatus('my-feature', 1, 'superseded');

    const result = await tool.execute({ name: 'my-feature', body: 'new version' });
    expect(result).toContain('v2');

    const v2 = await store.get('my-feature', 2);
    expect(v2!.meta.status).toBe('draft');
  });

  it('preserves createdAt on draft overwrite', async () => {
    const tool = createSaveSpecTool(store);
    await tool.execute({ name: 'my-feature', body: 'first' });
    const v1 = await store.get('my-feature', 1);
    const originalCreatedAt = v1!.meta.createdAt;

    // Small delay to ensure timestamps would differ if createdAt was regenerated
    await new Promise((r) => setTimeout(r, 10));

    await tool.execute({ name: 'my-feature', body: 'second overwrite' });
    const overwritten = await store.get('my-feature', 1);
    expect(overwritten!.meta.createdAt).toBe(originalCreatedAt); // preserved
    expect(overwritten!.meta.updatedAt).not.toBe(originalCreatedAt); // updated
  });

  it('writes version 3 correctly after two upgrades', async () => {
    const tool = createSaveSpecTool(store);

    // v1 → approve → upgrade → v2 → approve → upgrade → v3
    await tool.execute({ name: 'multi', body: 'v1' });
    await store.updateStatus('multi', 1, 'approved');

    await tool.execute({ name: 'multi', body: 'v2' });
    await store.updateStatus('multi', 2, 'approved');

    const result = await tool.execute({ name: 'multi', body: 'v3' });
    expect(result).toContain('v3');

    const doc = await store.get('multi', 3);
    expect(doc!.body).toBe('v3');
  });

  // --- Negative paths (≥30%) ---

  it('rejects empty name via Zod schema', () => {
    const tool = createSaveSpecTool(store);
    const result = tool.parameters.safeParse({ name: '', body: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects missing name via Zod schema', () => {
    const tool = createSaveSpecTool(store);
    const result = tool.parameters.safeParse({ body: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects missing body via Zod schema', () => {
    const tool = createSaveSpecTool(store);
    const result = tool.parameters.safeParse({ name: 'test' });
    expect(result.success).toBe(false);
  });
});
