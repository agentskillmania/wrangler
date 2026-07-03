import { describe, it, expect } from 'vitest';
import { shiftHeadings } from '../../../src/runner/shift-headings.js';

describe('shiftHeadings', () => {
  it('shifts h1 to h3 by 2 levels', () => {
    expect(shiftHeadings('# Title', 2)).toBe('### Title');
  });

  it('shifts h2 to h4 by 2 levels', () => {
    expect(shiftHeadings('## Subtitle', 2)).toBe('#### Subtitle');
  });

  it('shifts h3 to h5 by 2 levels', () => {
    expect(shiftHeadings('### Detail', 2)).toBe('##### Detail');
  });

  it('clamps at h6 maximum', () => {
    expect(shiftHeadings('##### Five', 2)).toBe('###### Five');
    expect(shiftHeadings('###### Six', 2)).toBe('###### Six');
  });

  it('shifts multiple headings in a document', () => {
    const input = `# Title

Some text here.

## Section One

### Subsection

More content.

## Section Two`;

    const result = shiftHeadings(input, 2);

    expect(result).toContain('### Title');
    expect(result).toContain('#### Section One');
    expect(result).toContain('##### Subsection');
    expect(result).toContain('#### Section Two');
  });

  it('does not affect non-heading lines starting with #', () => {
    const input = 'This is not a heading # but has a hash\nNeither is this#one';
    expect(shiftHeadings(input, 2)).toBe(input);
  });

  it('handles empty string', () => {
    expect(shiftHeadings('', 2)).toBe('');
  });

  it('handles document with no headings', () => {
    const input = 'Just some plain text\nwith no headings at all';
    expect(shiftHeadings(input, 2)).toBe(input);
  });

  it('preserves heading content after the space', () => {
    expect(shiftHeadings('# Hello World **bold**', 2)).toBe('### Hello World **bold**');
  });

  it('BUG8: does not shift heading-like text inside code blocks', () => {
    const input = '```\n# This is code\n```\n# This is a heading';
    const result = shiftHeadings(input, 2);
    // Code block content must NOT be shifted
    expect(result).toContain('# This is code');
    expect(result).not.toContain('### This is code');
    // Heading outside code block IS shifted
    expect(result).toContain('### This is a heading');
  });

  it('BUG8: does not shift # comments inside ~~~ code blocks', () => {
    const input = '~~~bash\n# set environment variable\nexport FOO=bar\n~~~\n# Real heading';
    const result = shiftHeadings(input, 2);
    expect(result).toContain('# set environment variable');
    expect(result).not.toContain('### set environment variable');
    expect(result).toContain('### Real heading');
  });

  it('BUG8: handles indented code fences', () => {
    const input = '  ```\n  # indented code comment\n  ```\n# Heading';
    const result = shiftHeadings(input, 2);
    expect(result).toContain('# indented code comment');
    expect(result).toContain('### Heading');
  });

  it('shifts by 1 level', () => {
    expect(shiftHeadings('# Title', 1)).toBe('## Title');
    expect(shiftHeadings('## Sub', 1)).toBe('### Sub');
  });

  it('shifts by 3 levels', () => {
    expect(shiftHeadings('# Title', 3)).toBe('#### Title');
  });
});
