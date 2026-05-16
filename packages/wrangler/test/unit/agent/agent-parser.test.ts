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

  it('parses sandbox: true from frontmatter', () => {
    const content = `---
name: sandboxed-agent
sandbox: true
---

I run in a sandbox.`;
    const result = parseAgentMd(content);
    expect(result.name).toBe('sandboxed-agent');
    expect(result.sandbox).toBe(true);
  });

  it('parses sandbox: false from frontmatter', () => {
    const content = `---
name: host-agent
sandbox: false
---

I run on host.`;
    const result = parseAgentMd(content);
    expect(result.name).toBe('host-agent');
    expect(result.sandbox).toBe(false);
  });

  it('defaults sandbox to undefined when not specified', () => {
    const content = `---
name: default-agent
---

No sandbox field.`;
    const result = parseAgentMd(content);
    expect(result.sandbox).toBeUndefined();
  });
});
