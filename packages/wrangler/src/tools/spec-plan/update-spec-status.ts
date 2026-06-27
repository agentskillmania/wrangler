import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { SpecStore } from '../../spec-plan/spec-store.js';
import type { SpecStatus } from '../../spec-plan/types.js';

const UpdateSpecStatusSchema = z.object({
  name: z.string().min(1).describe('Spec name'),
  version: z.number().int().positive().describe('Spec version'),
  status: z.enum(['draft', 'approved', 'superseded']).describe('New status'),
});

/**
 * Create the update_spec_status tool
 *
 * Updates the status of a spec document. Validates the status transition
 * against the spec state machine (draft → approved → superseded).
 */
export function createUpdateSpecStatusTool(specStore: SpecStore): Tool<ZodTypeAny> {
  return {
    name: 'update_spec_status',
    description:
      'Update the status of a spec document. Valid transitions: draft→approved, approved→superseded.',
    parameters: UpdateSpecStatusSchema,
    async execute(args: z.infer<typeof UpdateSpecStatusSchema>) {
      try {
        await specStore.updateStatus(args.name, args.version, args.status as SpecStatus);
        return `Spec '${args.name}' v${args.version} status updated to '${args.status}'.`;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return `Error: ${message}`;
      }
    },
  };
}
