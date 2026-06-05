/** Maximum length for the truncated initial title. */
export const MAX_TITLE_LENGTH = 50;

/** Maximum length for assistant response summary sent to LLM. */
const MAX_SUMMARY_LENGTH = 500;

/**
 * Extract an initial title from the user's first message.
 * Takes the first line, trims whitespace, truncates to MAX_TITLE_LENGTH.
 * Returns "Untitled" for empty or whitespace-only input.
 */
export function extractTitle(userMessage: string): string {
  if (!userMessage || !userMessage.trim()) {
    return 'Untitled';
  }

  // Take first line only
  const firstLine = userMessage.split('\n')[0] ?? userMessage;
  const trimmed = firstLine.trim();

  if (!trimmed) {
    return 'Untitled';
  }

  if (trimmed.length <= MAX_TITLE_LENGTH) {
    return trimmed;
  }

  // Truncate at word boundary when possible
  const truncated = trimmed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > MAX_TITLE_LENGTH * 0.5) {
    return truncated.slice(0, lastSpace);
  }
  return truncated;
}

/**
 * Generate the LLM prompt for session title creation.
 * Returns the prompt string ready to send to the LLM.
 */
export function generateTitlePrompt(userMessage: string, assistantSummary: string): string {
  const summary =
    assistantSummary.length > MAX_SUMMARY_LENGTH
      ? assistantSummary.slice(0, MAX_SUMMARY_LENGTH)
      : assistantSummary;

  return `Generate a concise title (5-8 words) for this conversation session.
Use English. Do not use quotes. Do not end with punctuation.

User's first message: ${userMessage}
Assistant's response summary: ${summary}

Title:`;
}
