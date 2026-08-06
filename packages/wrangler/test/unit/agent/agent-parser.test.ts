import { describe, it, expect } from 'vitest';
import { parseAgentMd } from '../../../src/agent/agent-parser.js';

describe('parseAgentMd', () => {
  it('parses agent with frontmatter and body', () => {
    const content = `---
name: developer
description: Code specialist
thinking:
  enabled: true
---

You are a senior developer.`;

    const result = parseAgentMd(content);
    expect(result.name).toBe('developer');
    expect(result.description).toBe('Code specialist');
    expect(result.thinking?.enabled).toBe(true);
    expect(result.instructions).toContain('You are a senior developer.');
    expect(result.instructions).not.toContain('当前时间');
  });

  it('parses agent without frontmatter using fallbackName', () => {
    const content = 'You are a helpful assistant.';
    const result = parseAgentMd(content, 'fallback');
    expect(result.name).toBe('fallback');
    expect(result.instructions).toContain('You are a helpful assistant.');
  });

  it('handles empty content', () => {
    const result = parseAgentMd('', 'empty');
    expect(result.name).toBe('empty');
    expect(result.instructions).toBe('');
  });

  it('handles missing name in frontmatter', () => {
    const content = `---
description: No name
---

Instructions here`;
    const result = parseAgentMd(content, 'fallback');
    expect(result.name).toBe('fallback');
    expect(result.instructions).toContain('Instructions here');
  });

  it('handles unclosed frontmatter', () => {
    const content = `---
name: broken
this has no closing dashes`;
    const result = parseAgentMd(content, 'fallback');
    expect(result.name).toBe('fallback');
  });

  it('handles yaml parse error gracefully', () => {
    const content = `---
name: [invalid: yaml
---

Body`;
    const result = parseAgentMd(content, 'fallback');
    expect(result.name).toBe('fallback');
  });

  it('defaults name to unknown when no fallback provided', () => {
    const content = 'Just instructions';
    const result = parseAgentMd(content);
    expect(result.name).toBe('unknown');
  });

  // BUG7: frontmatter closing '---' must be on its own line.
  // Body text containing '---' (markdown horizontal rule) must NOT be
  // mistaken for the frontmatter delimiter.
  it('BUG7: body with --- horizontal rule is not truncated', () => {
    const content = `---
name: test-agent
description: Has a rule in body
---

Section 1

---

Section 2`;
    const result = parseAgentMd(content);
    expect(result.name).toBe('test-agent');
    // Both sections must be present — the --- in body must not truncate
    expect(result.instructions).toContain('Section 1');
    expect(result.instructions).toContain('Section 2');
  });

  it('BUG7: body with --- mid-line is not truncated', () => {
    const content = `---
name: test-agent
---

Some---text with dashes`;
    const result = parseAgentMd(content);
    expect(result.instructions).toContain('Some---text');
  });
});
