/**
 * @fileoverview Markdown heading level shifter
 *
 * Shifts all ATX headings (# at start of line) by a given number of levels.
 * Used to nest AGENT.md and SKILL.md content under parent sections without
 * breaking the heading hierarchy.
 */

/**
 * Shift all markdown headings by `levels` (positive = deeper).
 *
 * @example shiftHeadings("## Foo\n### Bar", 2) → "#### Foo\n##### Bar"
 *
 * Only matches ATX headings (1-6 `#` at start of line followed by a space).
 * Headings already at level 6 stay at level 6 (max heading depth).
 */
export function shiftHeadings(markdown: string, levels: number): string {
  // BUG8 fix: skip headings inside fenced code blocks (``` or ~~~).
  // The old regex matched any line starting with # — including bash comments
  // (# set -e) or markdown headings inside code examples.
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  const fenceRegex = /^(\s*)(```|~~~)/;

  const result = lines.map((line) => {
    // Toggle code block state on fence lines
    if (fenceRegex.test(line)) {
      inCodeBlock = !inCodeBlock;
      return line;
    }

    // Skip heading shift inside code blocks
    if (inCodeBlock) return line;

    // Shift ATX headings (1-6 # at start of line followed by a space)
    const headingMatch = /^(#{1,6})\s/.exec(line);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const shifted = Math.min(hashes.length + levels, 6);
      return line.replace(/^(#{1,6})\s/, `${'#'.repeat(shifted)} `);
    }

    return line;
  });

  return result.join('\n');
}
