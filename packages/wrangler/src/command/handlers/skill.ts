import type { ISkillProvider } from '@agentskillmania/colts';
import { addAssistantMessage, addToolMessage, loadSkill } from '@agentskillmania/colts';

import type { CommandHandler } from '../types.js';

/**
 * The SWITCH_SKILL signal shape the load_skill tool returns (the colts
 * SkillSignal subset this handler produces).
 */
interface SwitchSkillSignalShape {
  type: 'SWITCH_SKILL';
  to: string;
  instructions: string;
  task: string;
  resources: string[];
  scripts: string[];
}

/**
 * Format a SWITCH_SKILL signal into its tool-result content — a byte-
 * compatible mirror of colts's formatSkillToolResult (the load_skill tool
 * path's single source of truth), covering the SWITCH_SKILL branch this
 * handler produces.
 *
 * Why a local mirror: colts 0.5.0-alpha.1 exports the formatter only from
 * its internal skills module — the package main entry re-exports neither it
 * nor a ./skills subpath (deep imports are blocked by the exports field).
 * Byte parity is pinned by the cross-boundary test in
 * test/unit/command/handlers/skill.test.ts, which drives colts's real
 * ExecutingToolHandler + load_skill tool and compares the persisted tool
 * result byte-for-byte. Handoff: once a colts alpha exports
 * formatSkillToolResult from the main index, replace this mirror with the
 * import. (R2P-114w, aligned with Rust f1096cc.)
 */
export function formatSkillToolResult(signal: SwitchSkillSignalShape): string {
  const lines: string[] = [];
  if (signal.resources.length > 0) {
    lines.push(`resources: ${signal.resources.join(', ')}`);
  }
  if (signal.scripts.length > 0) {
    lines.push(`scripts: ${signal.scripts.join(', ')}`);
  }
  if (lines.length === 0) {
    return signal.instructions;
  }
  return (
    `${signal.instructions}\n\n--- bundled files (use these exact paths with read_skill_resource` +
    ` / run_skill_script) ---\n${lines.join('\n')}`
  );
}

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
export function createSkillHandler(skillProvider: ISkillProvider): CommandHandler {
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
        const manifest = await skillProvider.getManifest(skillName);
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
        // whose content is the formatted SWITCH_SKILL result — instructions plus
        // the bundled-file inventory, byte-identical to the tool path. The
        // read_skill_resource / run_skill_script path contract ("use the exact
        // paths from the inventory returned by load_skill") requires the
        // inventory here too: injecting bare instructions would leave the model
        // with no legal path source under the guard wording.
        // (R2P-114w, aligned with Rust f1096cc.)
        const skillResult: SwitchSkillSignalShape = {
          type: 'SWITCH_SKILL',
          to: skillName,
          instructions,
          task: ctx.command.body,
          resources: manifest.resources ?? [],
          scripts: manifest.scripts ?? [],
        };
        const formatted = formatSkillToolResult(skillResult);
        const toolCallId = globalThis.crypto.randomUUID();
        newState = addAssistantMessage(newState, '', {
          toolCalls: [{ id: toolCallId, name: 'load_skill', arguments: { name: skillName } }],
        });
        newState = addToolMessage(newState, formatted, {
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
