import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { PlanStore } from '../../spec-plan/plan-store.js';

const ListPlansSchema = z.object({
  specName: z.string().optional().describe('Filter by spec name'),
});

/**
 * Create the list_plans tool
 *
 * Lists all plan documents. Optionally filter by specName.
 */
export function createListPlansTool(planStore: PlanStore): Tool<ZodTypeAny> {
  return {
    name: 'list_plans',
    description: 'List all plan documents. Optionally filter by specName.',
    parameters: ListPlansSchema,
    async execute(args: z.infer<typeof ListPlansSchema>) {
      let docs = await planStore.list();

      if (args.specName) {
        docs = docs.filter((d) => d.meta.specName === args.specName);
      }

      if (docs.length === 0) {
        return 'No plans found.';
      }

      const lines = ['# Plans', ''];
      for (const doc of docs) {
        lines.push(
          `- **${doc.meta.name}** v${doc.meta.version} (spec: ${doc.meta.specName} v${doc.meta.specVersion}) — ${doc.meta.status}`
        );
      }
      return lines.join('\n');
    },
  };
}
