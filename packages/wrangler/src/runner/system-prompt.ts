/**
 * Runtime context for system prompts.
 *
 * Produces a YAML frontmatter block that the message assembler
 * prepends to agent instructions, yielding a well-structured
 * markdown system prompt.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Build YAML frontmatter containing current date/time and timezone.
 *
 * Returns a `---`-delimited block designed to be the first element
 * in the assembler's systemParts array.  When joined with `\n\n`
 * to the agent instructions, the LLM receives standard
 * markdown-with-frontmatter:
 *
 * ```
 * ---
 * Time: Tuesday, May 13, 2026, 10:06 AM
 * Timezone: Asia/Shanghai
 * ---
 *
 * (agent instructions in markdown)
 * ```
 */
export function buildTimeContext(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const timestamp = `${WEEKDAYS[now.getDay()]}, ${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `---\nTime: ${timestamp}\nTimezone: ${tz}\n---`;
}
