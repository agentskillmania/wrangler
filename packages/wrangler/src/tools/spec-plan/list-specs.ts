import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { SpecStore } from '../../spec-plan/spec-store.js';

const ListSpecsSchema = z.object({}).strict();

/**
 * Create the list_specs tool
 *
 * Lists all spec documents with their name, version, and status.
 */
export function createListSpecsTool(specStore: SpecStore): Tool<ZodTypeAny> {
  return {
    name: 'list_specs',
    description: 'List all spec documents with name, version, and status.',
    parameters: ListSpecsSchema,
    async execute(_args: z.infer<typeof ListSpecsSchema>) {
      const docs = await specStore.list();
      if (docs.length === 0) {
        return 'No specs found.';
      }

      const lines = ['# Specs', ''];
      for (const doc of docs) {
        lines.push(`- **${doc.meta.name}** v${doc.meta.version} — ${doc.meta.status}`);
      }
      return lines.join('\n');
    },
  };
}
