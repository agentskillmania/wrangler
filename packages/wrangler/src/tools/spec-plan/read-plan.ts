import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { PlanStore } from '../../spec-plan/plan-store.js';

const ReadPlanSchema = z.object({
  name: z.string().min(1).describe('Plan name'),
  specVersion: z.number().int().positive().optional().describe('Spec version'),
  version: z.number().int().positive().optional().describe('Plan version (omit for latest)'),
});

/**
 * Create the read_plan tool
 *
 * Reads a plan document. If specVersion and version are omitted,
 * returns the latest plan version for the given plan name.
 */
export function createReadPlanTool(planStore: PlanStore): Tool<ZodTypeAny> {
  return {
    name: 'read_plan',
    description:
      'Read a plan document. Returns the latest version if specVersion/version are not specified.',
    parameters: ReadPlanSchema,
    async execute(args: z.infer<typeof ReadPlanSchema>) {
      let doc;
      if (args.version !== undefined && args.specVersion !== undefined) {
        doc = await planStore.get(args.name, args.specVersion, args.version);
      } else {
        // Find latest plan by plan name (args.name is the plan name, not spec name)
        const all = await planStore.list();
        const matching = all.filter(
          (d) =>
            d.meta.name === args.name &&
            (args.specVersion === undefined || d.meta.specVersion === args.specVersion)
        );
        matching.sort((a, b) => b.meta.version - a.meta.version);
        doc = matching.length > 0 ? matching[0] : null;
      }

      if (!doc) {
        const versionHint = args.version !== undefined ? ` v${args.version}` : '';
        const specHint = args.specVersion !== undefined ? ` (spec v${args.specVersion})` : '';
        return `Error: Plan '${args.name}'${versionHint}${specHint} not found.`;
      }

      return [
        `# Plan: ${doc.meta.name} v${doc.meta.version}`,
        `**Spec:** ${doc.meta.specName} v${doc.meta.specVersion}`,
        `**Status:** ${doc.meta.status}`,
        `**Created:** ${doc.meta.createdAt}`,
        `**Updated:** ${doc.meta.updatedAt}`,
        '',
        doc.body,
      ].join('\n');
    },
  };
}
