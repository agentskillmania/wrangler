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
      'Read a resource file from a skill directory by relative path (e.g. "reference/component-catalog.md", "scripts/validate.py"). Use after load_skill to access reference docs and bundled assets.',
    parameters: z.object({
      skill_name: z.string().describe('The skill name the resource belongs to'),
      resource_path: z.string().describe('Path to the resource, relative to the skill directory'),
    }),
    execute: async ({ skill_name, resource_path }): Promise<string> => {
      const manifest = await skillProvider.getManifest(skill_name);
      if (!manifest) {
        const available = (await skillProvider.listSkills()).map((s) => s.name);
        return `Skill '${skill_name}' not found. Available: ${available.join(', ')}`;
      }
      return skillProvider.loadResource(skill_name, resource_path);
    },
  };
}
