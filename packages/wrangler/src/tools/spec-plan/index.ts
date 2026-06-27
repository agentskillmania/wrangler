import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { createListPlansTool } from './list-plans.js';
import { createListSpecsTool } from './list-specs.js';
import { createReadPlanTool } from './read-plan.js';
import { createReadSpecTool } from './read-spec.js';
import { createSavePlanTool } from './save-plan.js';
import { createSaveSpecTool } from './save-spec.js';
import { createUpdatePlanStatusTool } from './update-plan-status.js';
import { createUpdateSpecStatusTool } from './update-spec-status.js';
import type { PlanStore } from '../../spec-plan/plan-store.js';
import type { SpecStore } from '../../spec-plan/spec-store.js';

/**
 * Create all spec-plan tools (8 total: 4 spec + 4 plan).
 *
 * @param specStore - SpecStore instance for spec document operations
 * @param planStore - PlanStore instance for plan document operations
 * @returns Array of 8 Tool instances
 */
export function createSpecPlanTools(
  specStore: SpecStore,
  planStore: PlanStore
): Tool<ZodTypeAny>[] {
  return [
    createSaveSpecTool(specStore),
    createReadSpecTool(specStore),
    createListSpecsTool(specStore),
    createUpdateSpecStatusTool(specStore),
    createSavePlanTool(planStore),
    createReadPlanTool(planStore),
    createListPlansTool(planStore),
    createUpdatePlanStatusTool(planStore),
  ];
}

// Re-export individual tool factories for testing
export { createSaveSpecTool } from './save-spec.js';
export { createReadSpecTool } from './read-spec.js';
export { createListSpecsTool } from './list-specs.js';
export { createUpdateSpecStatusTool } from './update-spec-status.js';
export { createSavePlanTool } from './save-plan.js';
export { createReadPlanTool } from './read-plan.js';
export { createListPlansTool } from './list-plans.js';
export { createUpdatePlanStatusTool } from './update-plan-status.js';
