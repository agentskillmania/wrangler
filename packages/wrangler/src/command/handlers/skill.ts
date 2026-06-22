import { randomUUID } from 'node:crypto';

import type { FilesystemSkillProvider } from '@agentskillmania/colts';
import { addAssistantMessage, addToolMessage, loadSkill } from '@agentskillmania/colts';

import type { CommandHandler } from '../types.js';

/**
 * Creates a command handler that loads a skill by name into the agent state.
 *
 * The handler behavior depends on whether a message body is provided:
 * - With body: Returns handled=false to continue execution, allowing the LLM to process the message with the skill loaded
 * - Without body: Returns handled=true with a confirmation message, stopping execution
 *
 * Skill instructions are persisted into conversation history as a synthesized
 * `load_skill` tool-call + tool-result pair, mirroring the LLM-driven load_skill
 * path. This keeps the slash-command shortcut consistent with the tool path so
 * the compressor's skill-exemption can find and protect the instruction payload.
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

      if (!/^[\w-]+$/.test(skillName)) {
        return {
          handled: true,
          response: 'Invalid skill name. Use alphanumeric, dash, underscore only.',
        };
      }

      try {
        const manifest = skillProvider.getManifest(skillName);
        if (!manifest) {
          return { handled: true, response: `Skill '${skillName}' not found.` };
        }

        const instructions = await skillProvider.loadInstructions(skillName);
        // Set skillState.current (for UI display). The instruction payload itself
        // is persisted via the synthesized tool-result below — loadSkill does not
        // store instructions into state by design.
        let newState = loadSkill(ctx.state, skillName, instructions);

        // Synthesize the same history shape the LLM-driven load_skill tool produces:
        // an assistant message carrying the toolCall, followed by a tool message
        // whose content is the skill instructions. This is the single point where
        // instructions enter conversation history for the slash-command path.
        const toolCallId = randomUUID();
        newState = addAssistantMessage(newState, '', {
          toolCalls: [{ id: toolCallId, name: 'load_skill', arguments: { name: skillName } }],
        });
        newState = addToolMessage(newState, instructions, {
          toolCallId,
          toolName: 'load_skill',
        });

        // If body is present, continue run so LLM processes the message with skill loaded
        if (ctx.command.body) {
          return { handled: false, state: newState };
        }

        return {
          handled: true,
          state: newState,
          response: `Skill '${skillName}' loaded.`,
        };
      } catch (err) {
        return {
          handled: true,
          response: `Failed to load skill '${skillName}': ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
