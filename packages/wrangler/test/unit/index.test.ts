import { describe, it, expect } from 'vitest';

describe('@agentskillmania/wrangler exports', () => {
  it('exports key APIs that can be imported and called', async () => {
    const mod = await import('../../src/index.js');

    // EnhancedRunner is a class with static create method
    expect(typeof mod.EnhancedRunner).toBe('function');
    expect(typeof mod.EnhancedRunner.create).toBe('function');

    // AgentLoader is a class
    expect(typeof mod.AgentLoader).toBe('function');

    // Crew is a class
    expect(typeof mod.Crew).toBe('function');

    // SessionStore is a class
    expect(typeof mod.SessionStore).toBe('function');

    // Tool creators are functions
    expect(typeof mod.createBuiltinTools).toBe('function');
  });

  it('parseCommand parses slash commands correctly', async () => {
    const { parseCommand } = await import('../../src/index.js');
    expect(parseCommand('/clear')).toEqual({ name: 'clear', target: undefined, body: '' });
    expect(parseCommand('/skill:my-skill do this')).toEqual({
      name: 'skill',
      target: 'my-skill',
      body: 'do this',
    });
    expect(parseCommand('hello world')).toBeNull();
  });

  it('parseAgentMd parses YAML frontmatter and markdown body', async () => {
    const { parseAgentMd } = await import('../../src/index.js');
    const md = `---
name: test-agent
model: gpt-4o
---
You are a helpful assistant.`;
    const parsed = parseAgentMd(md);
    expect(parsed.name).toBe('test-agent');
    expect(parsed.model).toBe('gpt-4o');
    expect(parsed.instructions).toContain('helpful assistant');
  });
});
