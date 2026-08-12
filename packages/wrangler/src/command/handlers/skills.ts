import type { ISkillProvider } from '@agentskillmania/colts';

import type { CommandHandler } from '../types.js';

/**
 * Creates a command handler that lists all available skills from the skill provider.
 *
 * @param skillProvider - The skill provider instance to query for skills
 * @returns A CommandHandler that lists available skills
 *
 * @example
 * ```ts
 * const handler = createSkillsHandler(skillProvider);
 * const result = await handler.handle(ctx);
 * console.log(result.response); // "Available skills:\n1. code-review — ..."
 * ```
 */
export function createSkillsHandler(skillProvider: ISkillProvider): CommandHandler {
  return {
    name: 'skills',
    description: 'List available skills',
    async handle() {
      const skills = skillProvider.listSkills();
      if (skills.length === 0) {
        return { handled: true, response: 'No skills available.' };
      }
      const lines = skills.map((s, i) => `${i + 1}. ${s.name} — ${s.description}`);
      return {
        handled: true,
        response: `Available skills:\n${lines.join('\n')}`,
      };
    },
  };
}
