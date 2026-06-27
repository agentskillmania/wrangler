import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { SpecStore } from '../../spec-plan/spec-store.js';

const ReadSpecSchema = z.object({
  name: z.string().min(1).describe('Spec name'),
  version: z.number().int().positive().optional().describe('Spec version (omit for latest)'),
});

/**
 * Create the read_spec tool
 *
 * Reads a spec document. If version is omitted, returns the latest version.
 * Returns the spec metadata and body as formatted markdown.
 */
export function createReadSpecTool(specStore: SpecStore): Tool<ZodTypeAny> {
  return {
    name: 'read_spec',
    description: 'Read a spec document. Returns the latest version if version is not specified.',
    parameters: ReadSpecSchema,
    async execute(args: z.infer<typeof ReadSpecSchema>) {
      const doc = args.version
        ? await specStore.get(args.name, args.version)
        : await specStore.getLatest(args.name);

      if (!doc) {
        const versionHint = args.version ? ` v${args.version}` : '';
        return `Error: Spec '${args.name}'${versionHint} not found.`;
      }

      return [
        `# Spec: ${doc.meta.name} v${doc.meta.version}`,
        `**Status:** ${doc.meta.status}`,
        `**Created:** ${doc.meta.createdAt}`,
        `**Updated:** ${doc.meta.updatedAt}`,
        '',
        doc.body,
      ].join('\n');
    },
  };
}
