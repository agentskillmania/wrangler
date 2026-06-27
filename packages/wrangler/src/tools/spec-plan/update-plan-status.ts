import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { PlanStore } from '../../spec-plan/plan-store.js';
import type { PlanStatus } from '../../spec-plan/types.js';

const UpdatePlanStatusSchema = z.object({
  name: z.string().min(1).describe('Plan name'),
  specVersion: z.number().int().positive().describe('Spec version'),
  version: z.number().int().positive().describe('Plan version'),
  status: z.enum(['draft', 'approved', 'executing', 'completed']).describe('New status'),
});

/**
 * Create the update_plan_status tool
 *
 * Updates the status of a plan document. Validates the status transition
 * against the plan state machine (draft → approved → executing → completed).
 */
export function createUpdatePlanStatusTool(planStore: PlanStore): Tool<ZodTypeAny> {
  return {
    name: 'update_plan_status',
    description:
      'Update the status of a plan document. Valid transitions: draft→approved, approved→executing, executing→completed.',
    parameters: UpdatePlanStatusSchema,
    async execute(args: z.infer<typeof UpdatePlanStatusSchema>) {
      try {
        await planStore.updateStatus(
          args.name,
          args.specVersion,
          args.version,
          args.status as PlanStatus
        );
        return `Plan '${args.name}' v${args.version} status updated to '${args.status}'.`;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return `Error: ${message}`;
      }
    },
  };
}
