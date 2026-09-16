/**
 * @fileoverview read_skill_resource tool
 *
 * Reads any file from a skill's directory by relative path. This complements
 * load_skill (which returns only the SKILL.md body) by giving the agent access
 * to reference documents, scripts, and any other bundled resources.
 */

import type { ISkillProvider } from '@agentskillmania/colts';
import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

/**
 * Create the read_skill_resource tool.
 *
 * @param skillProvider - Skill provider instance
 * @returns Tool definition
 */
export function createReadResourceTool(skillProvider: ISkillProvider): Tool<ZodTypeAny> {
  return {
    name: 'read_skill_resource',
    description:
      'Read a resource file bundled with a skill, by the exact relative path from the ' +
      'file inventory returned when the skill was loaded (or a path explicitly mentioned ' +
      "in the skill's instructions). Do not construct or guess paths — on a failed read " +
      'the error lists what is actually available.',
    parameters: z.object({
      skill_name: z.string().describe('The skill name the resource belongs to'),
      resource_path: z
        .string()
        .describe(
          "Exact relative path from the skill's file inventory (returned by load_skill). Do not guess"
        ),
    }),
    execute: async ({ skill_name, resource_path }): Promise<string> => {
      const manifest = await skillProvider.getManifest(skill_name);
      if (!manifest) {
        const available = (await skillProvider.listSkills()).map((s) => s.name);
        return `Skill '${skill_name}' not found. Available: ${available.join(', ')}`;
      }
      try {
        return await skillProvider.loadResource(skill_name, resource_path);
      } catch (err) {
        // Failure self-heal: attach the skill's ACTUAL resource inventory so
        // the model corrects itself in one shot instead of guessing more
        // path shapes. Without an inventory there is nothing to suggest —
        // surface the original error. (R2P-114w, aligned with Rust c78cfcc.)
        const available = manifest.resources ?? [];
        if (available.length === 0) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        return `${message}. Available resources in skill '${skill_name}': ${available.join(', ')}`;
      }
    },
  };
}
