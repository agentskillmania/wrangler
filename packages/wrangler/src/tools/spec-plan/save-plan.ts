import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { PlanStore } from '../../spec-plan/plan-store.js';

const SavePlanSchema = z.object({
  name: z.string().min(1).describe('Plan name (kebab-case identifier)'),
  specVersion: z.number().int().positive().describe('Associated spec version'),
  body: z.string().describe('Plan document body in markdown format'),
});

/**
 * Create the save_plan tool
 *
 * Saves a plan document:
 * - New plan → v1(draft) scoped to (name, specVersion)
 * - Same scope, existing draft → overwrites body/updatedAt, version unchanged
 * - Same scope, existing non-draft (approved/executing/completed) → creates new version as draft (upgrade)
 * - Different specVersion → independent version sequence starting at v1
 */
export function createSavePlanTool(planStore: PlanStore): Tool<ZodTypeAny> {
  return {
    name: 'save_plan',
    description:
      'Save a plan document. Overwrites existing draft in same (name, specVersion) scope; increments version only when upgrading a non-draft plan.',
    parameters: SavePlanSchema,
    async execute(args: z.infer<typeof SavePlanSchema>) {
      const existing = await planStore.list();
      const sameScope = existing.filter(
        (d) => d.meta.name === args.name && d.meta.specVersion === args.specVersion
      );
      const latest =
        sameScope.length > 0
          ? sameScope.reduce((a, b) => (a.meta.version > b.meta.version ? a : b))
          : null;

      const now = new Date().toISOString();

      let version: number;
      let createdAt: string;

      if (!latest) {
        // Brand new plan in this scope
        version = 1;
        createdAt = now;
      } else if (latest.meta.status === 'draft') {
        // Overwrite existing draft — same version, preserve createdAt
        version = latest.meta.version;
        createdAt = latest.meta.createdAt;
      } else {
        // Upgrade: latest is approved/executing/completed — new version
        version = latest.meta.version + 1;
        createdAt = now;
      }

      await planStore.save({
        meta: {
          name: args.name,
          specName: args.name,
          specVersion: args.specVersion,
          version,
          status: 'draft',
          workspacePath: '',
          createdAt,
          updatedAt: now,
        },
        body: args.body,
      });

      const action = latest && latest.meta.status === 'draft' ? 'updated' : 'saved';
      return `Plan '${args.name}' ${action} as v${version} (spec v${args.specVersion}).`;
    },
  };
}
