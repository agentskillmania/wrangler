import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpecStore } from '../../../../src/spec-plan/spec-store.js';
import { PlanStore } from '../../../../src/spec-plan/plan-store.js';
import { createSpecPlanTools } from '../../../../src/tools/spec-plan/index.js';
import { NodeHostEnv } from '../../../../src/host-env/node-host-env.js';

describe('createSpecPlanTools', () => {
  let testDir: string;
  let specStore: SpecStore;
  let planStore: PlanStore;

  beforeEach(async () => {
    testDir = join(tmpdir(), `spec-plan-tools-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    specStore = new SpecStore(join(testDir, 'specs'), new NodeHostEnv());
    planStore = new PlanStore(join(testDir, 'plans'), new NodeHostEnv());
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns exactly 8 tools', () => {
    const tools = createSpecPlanTools(specStore, planStore);
    expect(tools).toHaveLength(8);
  });

  it('all tools have unique names', () => {
    const tools = createSpecPlanTools(specStore, planStore);
    const names = tools.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(8);
  });

  it('returns expected tool names', () => {
    const tools = createSpecPlanTools(specStore, planStore);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'list_plans',
      'list_specs',
      'read_plan',
      'read_spec',
      'save_plan',
      'save_spec',
      'update_plan_status',
      'update_spec_status',
    ]);
  });

  it('all tools have descriptions', () => {
    const tools = createSpecPlanTools(specStore, planStore);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it('spec tools and plan tools are wired to correct stores', async () => {
    const tools = createSpecPlanTools(specStore, planStore);

    // save_spec should write to specStore
    const saveSpec = tools.find((t) => t.name === 'save_spec')!;
    await saveSpec.execute({ name: 'test-spec', body: 'spec body' });
    const specDoc = await specStore.getLatest('test-spec');
    expect(specDoc).not.toBeNull();
    expect(specDoc!.body).toBe('spec body');

    // save_plan should write to planStore
    const savePlan = tools.find((t) => t.name === 'save_plan')!;
    await savePlan.execute({ name: 'test-plan', specVersion: 1, body: 'plan body' });
    const planDoc = await planStore.get('test-plan', 1, 1);
    expect(planDoc).not.toBeNull();
    expect(planDoc!.body).toBe('plan body');
  });
});
