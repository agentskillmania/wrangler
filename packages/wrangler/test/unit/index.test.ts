import { describe, it, expect } from 'vitest';
import {
  AgentHarness,
  EnhancedRunner,
  AgentLoader,
  CrewLoader,
  SessionStore,
  createCoreTools,
  parseCommand,
  CommandRegistry,
  createCommandMiddleware,
  parseAgentMd,
  createLLMClient,
  resolveDefaultModel,
} from '../../src/index.js';

describe('@agentskillmania/wrangler exports', () => {
  it('exports key APIs that can be imported and called', () => {
    // AgentHarness is a class with static create method
    expect(AgentHarness).toBeInstanceOf(Function);
    expect(AgentHarness.name).toBe('AgentHarness');
    expect(AgentHarness.create).toBeInstanceOf(Function);

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
    expect(createCoreTools).toBeInstanceOf(Function);
    expect(createCoreTools.name).toBe('createCoreTools');

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

  // ── Deprecated alias compatibility (T9 rename, D3: alias for one minor) ──
  it('keeps deprecated EnhancedRunner alias identical to AgentHarness', () => {
    expect(EnhancedRunner).toBe(AgentHarness);
  });

  it('deprecated EnhancedRunner alias is still constructible and has create()', () => {
    expect(EnhancedRunner.create).toBeInstanceOf(Function);
    // Runtime `new` via the old name dispatches to the AgentHarness constructor.
    const viaOldName = Reflect.construct(EnhancedRunner, [null, null, new Map(), []]);
    expect(viaOldName).toBeInstanceOf(AgentHarness);
    expect(viaOldName).toBeInstanceOf(EnhancedRunner);
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
