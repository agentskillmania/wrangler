/**
 * Runtime context for system prompts.
 *
 * Produces a YAML frontmatter block that the message assembler
 * prepends to agent instructions, yielding a well-structured
 * markdown system prompt.
 */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

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
 * 时间: 2026年05月13日 星期二 10:06
 * 时区: Asia/Shanghai
 * ---
 *
 * (agent instructions in markdown)
 * ```
 */
export function buildTimeContext(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const timestamp = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${WEEKDAYS[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `---\n时间: ${timestamp}\n时区: ${tz}\n---`;
}
