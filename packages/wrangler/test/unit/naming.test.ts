import { describe, it, expect } from 'vitest';
import { extractTitle, generateTitlePrompt, MAX_TITLE_LENGTH } from '../../src/session/naming.js';

describe('Session Naming', () => {
  describe('extractTitle', () => {
    it('truncates long messages to MAX_TITLE_LENGTH characters', () => {
      const longMessage = 'a'.repeat(100);
      const result = extractTitle(longMessage);
      expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    });

    it('returns short messages unchanged', () => {
      const msg = 'Fix the login bug';
      expect(extractTitle(msg)).toBe('Fix the login bug');
    });

    it('trims whitespace', () => {
      expect(extractTitle('  hello world  ')).toBe('hello world');
    });

    it('handles empty string', () => {
      expect(extractTitle('')).toBe('Untitled');
    });

    it('handles whitespace-only string', () => {
      expect(extractTitle('   ')).toBe('Untitled');
    });

    it('handles multiline by taking first line', () => {
      expect(extractTitle('first line\nsecond line')).toBe('first line');
    });

    it('truncates at word boundary when possible', () => {
      const msg =
        'This is a somewhat long message that should be truncated at a word boundary ideally';
      const result = extractTitle(msg);
      expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    });
  });

  describe('generateTitlePrompt', () => {
    it('includes user message and response summary', () => {
      const prompt = generateTitlePrompt('Fix the bug', 'I found the issue...');
      expect(prompt).toContain('Fix the bug');
      expect(prompt).toContain('I found the issue...');
    });

    it('truncates long response summary to 500 chars', () => {
      const longResponse = 'x'.repeat(1000);
      const prompt = generateTitlePrompt('Hello', longResponse);
      // The summary in the prompt should be at most 500 chars
      const lines = prompt.split('\n');
      const summaryLine = lines.find((l) => l.includes('x'.repeat(50))) ?? '';
      expect(summaryLine.length).toBeLessThanOrEqual(600); // 500 + prefix text
    });
  });
});
