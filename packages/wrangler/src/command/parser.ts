import type { ParsedCommand } from './types.js';

// Match: /command name (with word chars, dash, underscore), optional :target, optional body
// Groups: 1=name, 2=target (optional), 3=body (optional)
// The colon is only included if there's a valid target (non-whitespace immediately after)
const COMMAND_RE = /^\/([\w-]+)(?::(\S+))?(?:\s+([\s\S]*))?/;

/**
 * Parse a user message as a command.
 * Returns null if not a command.
 *
 * @param input - User input string to parse
 * @returns ParsedCommand structure or null if input is not a command
 */
export function parseCommand(input: string): ParsedCommand | null {
  const match = input.match(COMMAND_RE);
  if (!match) return null;

  return {
    name: match[1]!,
    target: match[2] || undefined,
    body: (match[3] || '').trim(),
  };
}
