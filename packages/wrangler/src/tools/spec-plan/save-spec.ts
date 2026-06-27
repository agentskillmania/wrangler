import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { SpecStore } from '../../spec-plan/spec-store.js';

const SaveSpecSchema = z.object({
  name: z.string().min(1).describe('Spec name (kebab-case identifier)'),
  body: z.string().describe('Spec document body in markdown format'),
});

/**
 * Create the save_spec tool
 *
 * Saves a spec document:
 * - New spec → v1(draft)
 * - Same name, existing draft → overwrites body/updatedAt, version unchanged
 * - Same name, existing approved/superseded → creates new version as draft (upgrade)
 */
export function createSaveSpecTool(specStore: SpecStore): Tool<ZodTypeAny> {
  return {
    name: 'save_spec',
    description:
      'Save a spec document. Overwrites existing draft with same name; increments version only when upgrading an approved or superseded spec.',
    parameters: SaveSpecSchema,
    async execute(args: z.infer<typeof SaveSpecSchema>) {
      const latest = await specStore.getLatest(args.name);
      const now = new Date().toISOString();

      let version: number;
      let createdAt: string;

      if (!latest) {
        // Brand new spec
        version = 1;
        createdAt = now;
      } else if (latest.meta.status === 'draft') {
        // Overwrite existing draft — same version, preserve createdAt
        version = latest.meta.version;
        createdAt = latest.meta.createdAt;
      } else {
        // Upgrade: latest is approved or superseded — new version
        version = latest.meta.version + 1;
        createdAt = now;
      }

      await specStore.save({
        meta: {
          name: args.name,
          version,
          status: 'draft',
          workspacePath: '',
          createdAt,
          updatedAt: now,
        },
        body: args.body,
      });

      const action = latest && latest.meta.status === 'draft' ? 'updated' : 'saved';
      return `Spec '${args.name}' ${action} as v${version}`;
    },
  };
}
