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
 */
export function enrichSystemPrompt(systemPrompt: string): string {
  const timestamp = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
  });
  return TIME_BLOCK.replace('{timestamp}', timestamp) + systemPrompt;
}
