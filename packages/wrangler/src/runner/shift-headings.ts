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
  return markdown.replace(/^(#{1,6})\s/gm, (_match, hashes: string) => {
    const shifted = Math.min(hashes.length + levels, 6);
    return `${'#'.repeat(shifted)} `;
  });
}
