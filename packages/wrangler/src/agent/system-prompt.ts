/**
 * Enrich system prompt with runtime context.
 */

const TIME_BLOCK = `<context>
当前时间：{timestamp}
</context>

`;

/**
 * Prepend current date/time context to the system prompt.
 *
 * LLMs have no built-in sense of "now" — this ensures the model
 * knows the actual date and time when generating responses.
 * Timezone is read from the runtime environment automatically.
 */
export function enrichSystemPrompt(systemPrompt: string): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const timestamp = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 ${WEEKDAYS[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} (${tz})`;
  return TIME_BLOCK.replace('{timestamp}', timestamp) + systemPrompt;
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
