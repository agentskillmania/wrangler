import { describe, it, expect } from 'vitest';
import { parseAgentMd } from '../../../src/agent/agent-loader.js';

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
    expect(result.meta.name).toBe('developer');
    expect(result.meta.description).toBe('Code specialist');
    expect(result.meta.thinking?.enabled).toBe(true);
    expect(result.instructions).toContain('You are a senior developer.');
    expect(result.instructions).not.toContain('当前时间');
  });

  it('parses agent without frontmatter using fallbackName', () => {
    const content = 'You are a helpful assistant.';
    const result = parseAgentMd(content, 'fallback');
    expect(result.meta.name).toBe('fallback');
    expect(result.instructions).toContain('You are a helpful assistant.');
  });

  it('handles empty content', () => {
    const result = parseAgentMd('', 'empty');
    expect(result.meta.name).toBe('empty');
    expect(result.instructions).toBe('');
  });

  it('handles missing name in frontmatter', () => {
    const content = `---
description: No name
---

Instructions here`;
    const result = parseAgentMd(content, 'fallback');
    expect(result.meta.name).toBe('fallback');
    expect(result.instructions).toContain('Instructions here');
  });

  it('handles unclosed frontmatter', () => {
    const content = `---
name: broken
this has no closing dashes`;
    const result = parseAgentMd(content, 'fallback');
    expect(result.meta.name).toBe('fallback');
  });

  it('handles yaml parse error gracefully', () => {
    const content = `---
name: [invalid: yaml
---

Body`;
    const result = parseAgentMd(content, 'fallback');
    expect(result.meta.name).toBe('fallback');
  });

  it('defaults name to unknown when no fallback provided', () => {
    const content = 'Just instructions';
    const result = parseAgentMd(content);
    expect(result.meta.name).toBe('unknown');
  });
});
