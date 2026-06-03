/* eslint-disable */
// ── Helper: sessionEntryToChatLine ──
// Convert a SessionEntry (from GET /api/chat/:id/messages) to a chatLine object
// compatible with ChatPage's chatLines array format: { tag, text, id }.

/**
 * @param {object} entry - A SessionEntry object
 * @returns {{ tag: string, text: string, id: string }}
 */
export function sessionEntryToChatLine(entry) {
  var tag = entry.role === 'assistant' ? 'token' : entry.role;
  var text = entry.content || '';
  if (entry.role === 'tool') {
    text = entry.toolName + '\n' + (entry.result || '(no result)');
  }
  if (entry.role === 'error') {
    text = entry.errorMessage || entry.content || 'Unknown error';
  }
  return { tag: tag, text: text, id: entry.id || Date.now() + Math.random() };
}
