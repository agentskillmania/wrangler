import { describe, it, expect } from 'vitest';
import {
  EnhancedRunner,
  AgentLoader,
  CrewLoader,
  SessionStore,
  createBuiltinTools,
  parseCommand,
  CommandRegistry,
  createCommandMiddleware,
  parseAgentMd,
  createLLMClient,
  resolveDefaultModel,
} from '../../src/index.js';

describe('@agentskillmania/wrangler exports', () => {
  it('exports key APIs that can be imported and called', () => {
    // EnhancedRunner is a class with static create method
    expect(EnhancedRunner).toBeInstanceOf(Function);
    expect(EnhancedRunner.name).toBe('EnhancedRunner');
    expect(EnhancedRunner.create).toBeInstanceOf(Function);

    // AgentLoader is a class
    expect(AgentLoader).toBeInstanceOf(Function);
    expect(AgentLoader.name).toBe('AgentLoader');

    // Crew is a class
    expect(CrewLoader).toBeInstanceOf(Function);
    expect(CrewLoader.name).toBe('CrewLoader');

    // SessionStore is a class
    expect(SessionStore).toBeInstanceOf(Function);
    expect(SessionStore.name).toBe('SessionStore');

    // Tool creators are functions
    expect(createBuiltinTools).toBeInstanceOf(Function);
    expect(createBuiltinTools.name).toBe('createBuiltinTools');

    // Command system
    expect(parseCommand).toBeInstanceOf(Function);
    expect(CommandRegistry).toBeInstanceOf(Function);
    expect(createCommandMiddleware).toBeInstanceOf(Function);

    // LLM client factory
    expect(createLLMClient).toBeInstanceOf(Function);
    expect(createLLMClient.name).toBe('createLLMClient');
    expect(resolveDefaultModel).toBeInstanceOf(Function);
    expect(resolveDefaultModel.name).toBe('resolveDefaultModel');
  });

  it('parseCommand parses slash commands correctly', () => {
    expect(parseCommand('/clear')).toEqual({ name: 'clear', target: undefined, body: '' });
    expect(parseCommand('/skill:my-skill do this')).toEqual({
      name: 'skill',
      target: 'my-skill',
      body: 'do this',
    });
    expect(parseCommand('hello world')).toBeNull();
  });

  it('parseAgentMd parses YAML frontmatter and markdown body', () => {
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
