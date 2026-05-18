import type { CommandHandler } from '../types.js';
import type { FilesystemSkillProvider } from '@agentskillmania/colts';
import { loadSkill } from '@agentskillmania/colts';

/**
 * Creates a command handler that loads a skill by name into the agent state.
 *
 * The handler behavior depends on whether a message body is provided:
 * - With body: Returns handled=false to continue execution, allowing the LLM to process the message with the skill loaded
 * - Without body: Returns handled=true with a confirmation message, stopping execution
 *
 * @param skillProvider - The FilesystemSkillProvider instance to load skills from
 * @returns A CommandHandler that loads skills by name
 *
 * @example
 * ```ts
 * const handler = createSkillHandler(skillProvider);
 * // Load skill without message: shows confirmation
 * const result1 = await handler.handle({ command: { name: 'skill', target: 'code-review', body: '' }, ... });
 * // Load skill with message: continues to LLM
 * const result2 = await handler.handle({ command: { name: 'skill', target: 'code-review', body: 'Review this code' }, ... });
 * ```
 */
export function createSkillHandler(skillProvider: FilesystemSkillProvider): CommandHandler {
  return {
    name: 'skill',
    description: 'Load a skill by name',
    async handle(ctx) {
      const skillName = ctx.command.target;
      if (!skillName) {
        return { handled: true, response: 'Usage: /skill:<name> [message]' };
      }

      const manifest = skillProvider.getManifest(skillName);
      if (!manifest) {
        return { handled: true, response: `Skill '${skillName}' not found.` };
      }

      const instructions = await skillProvider.loadInstructions(skillName);
      const newState = loadSkill(ctx.state, skillName, instructions);

      // If body is present, continue run so LLM processes the message with skill loaded
      if (ctx.command.body) {
        return { handled: false, state: newState };
      }

      return {
        handled: true,
        state: newState,
        response: `Skill '${skillName}' loaded.`,
      };
    },
  };
}
