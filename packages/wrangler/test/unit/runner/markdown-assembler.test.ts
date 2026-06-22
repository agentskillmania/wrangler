import { describe, it, expect } from 'vitest';
import { MarkdownMessageAssembler } from '../../../src/runner/markdown-assembler.js';
import type { AgentState } from '@agentskillmania/colts';
import type { BuildMessagesOptions } from '@agentskillmania/colts';

function makeState(overrides?: Partial<AgentState['config']>): AgentState {
  return {
    config: {
      name: 'test-agent',
      instructions: overrides?.instructions,
      tools: [],
      ...overrides,
    },
    context: {
      messages: [],
      stepCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    },
  } as AgentState;
}

function makeOpts(overrides?: Partial<BuildMessagesOptions>): BuildMessagesOptions {
  return {
    model: 'gpt-4',
    ...overrides,
  };
}

describe('MarkdownMessageAssembler', () => {
  it('returns null system doc when no system parts exist', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState();
    const opts = makeOpts();
    const messages = assembler.build(state, opts);

    // No system doc → no messages
    expect(messages).toHaveLength(0);
  });

  it('produces YAML frontmatter at position 0 with no prefix', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\ntz: UTC\n---',
    });

    const messages = assembler.build(state, opts);
    const firstUser = messages.find((m) => m.role === 'user');
    const content = typeof firstUser!.content === 'string' ? firstUser!.content : '';

    // YAML frontmatter at position 0, no [System Instructions] prefix
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).not.toContain('[System Instructions]');
  });

  it('wraps instructions in ## Instructions with heading shift', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({
      instructions: '# My Agent\n\n## Section\n\nDo things.',
    });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
    });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Instructions');
    // Original # → ### (shifted by 2)
    expect(content).toContain('### My Agent');
    // Original ## → #### (shifted by 2)
    expect(content).toContain('#### Section');
  });

  it('does not produce ## Instructions when no instructions given', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState();
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
    });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).not.toContain('## Instructions');
  });

  it('produces ## Available Skills when skill provider has skills', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      skillProvider: {
        listSkills: () => [
          { name: 'search', description: 'Search the web' },
          { name: 'code', description: 'Write code' },
        ],
      } as any,
    });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Available Skills');
    expect(content).toContain('- search: Search the web');
    expect(content).toContain('- code: Write code');
    expect(content).toContain('load_skill');
  });

  it('does not produce ## Available Skills when no skill provider', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).not.toContain('## Available Skills');
  });

  it('produces ## Sub-Agents when sub-agents configured', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const subAgentMap = new Map();
    subAgentMap.set('coder', {
      name: 'coder',
      description: 'Writes code',
    });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      subAgentConfigs: subAgentMap,
    });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Sub-Agents');
    expect(content).toContain('- coder: Writes code');
    expect(content).toContain('delegate');
  });

  it('produces ## Thinking when enablePromptThinking is true', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      enablePromptThinking: true,
    });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Thinking');
    expect(content).toContain('<think>');
  });

  it('does not produce ## Thinking when enablePromptThinking is false', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      enablePromptThinking: false,
    });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).not.toContain('## Thinking');
  });

  it('adds fake assistant acknowledgment after system doc', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);

    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'Understood. I will follow these instructions.',
        }),
      ])
    );
  });

  it('includes conversation history after system doc', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      { role: 'user', content: 'Hello', timestamp: 1000 },
      {
        role: 'assistant',
        content: 'Hi there',
        timestamp: 1001,
      },
    ] as any;
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);

    // System doc (user) + ack (assistant) + user msg + assistant msg
    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Hello');
    expect(messages[3].role).toBe('assistant');
  });

  it('handles tool messages in conversation history', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      {
        role: 'tool',
        content: 'result data',
        toolCallId: 'tc-1',
        toolName: 'search',
        timestamp: 1002,
      },
    ] as any;
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);

    const toolMsg = messages.find((m) => m.role === 'toolResult');
    expect(toolMsg!.toolCallId).toBe('tc-1');
    expect(toolMsg!.isError).toBe(false);
  });

  it('marks tool result as error when content starts with Error:', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      {
        role: 'tool',
        content: 'Error: File not found: missing.txt',
        toolCallId: 'tc-2',
        toolName: 'file_read',
        timestamp: 1003,
      },
    ] as any;
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);

    const toolMsg = messages.find((m) => m.role === 'toolResult' && m.toolCallId === 'tc-2');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.isError).toBe(true);
  });

  it('creates an assistant message when input has toolCalls', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      {
        role: 'assistant',
        content: 'Let me search.',
        toolCalls: [{ id: 'tc-1', name: 'search', arguments: { query: 'test' } }],
        timestamp: 1001,
      },
    ] as any;
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);

    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(2);
    const assistantMsg = assistantMsgs[1];
    expect(Array.isArray(assistantMsg.content)).toBe(true);
  });

  it('includes tool call details in assistant message content', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      {
        role: 'assistant',
        content: 'Let me search.',
        toolCalls: [{ id: 'tc-1', name: 'search', arguments: { query: 'test' } }],
        timestamp: 1001,
      },
    ] as any;
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);
    const assistantMsg = messages.filter((m) => m.role === 'assistant')[1];

    expect(assistantMsg.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'toolCall' })])
    );
    const toolCall = (assistantMsg.content as any[]).find((c: any) => c.type === 'toolCall');
    expect(toolCall).toEqual({
      type: 'toolCall',
      id: 'tc-1',
      name: 'search',
      arguments: { query: 'test' },
    });
  });

  it('sets stopReason to toolUse for assistant messages with toolCalls', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      {
        role: 'assistant',
        content: 'Let me search.',
        toolCalls: [{ id: 'tc-1', name: 'search', arguments: { query: 'test' } }],
        timestamp: 1001,
      },
    ] as any;
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);
    const assistantMsg = messages.filter((m) => m.role === 'assistant')[1];

    expect(assistantMsg.stopReason).toBe('toolUse');
  });

  it('handles assistant messages without toolCalls', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      {
        role: 'assistant',
        content: 'Just a reply.',
        timestamp: 1001,
      },
    ] as any;
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);

    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(2);
    const assistantMsg = assistantMsgs[1];
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Just a reply.' })])
    );
    expect(assistantMsg.stopReason).toBe('stop');
  });

  it('respects compression boundary', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    state.context.messages = [
      { role: 'user', content: 'old msg', timestamp: 1000 },
      { role: 'user', content: 'new msg', timestamp: 1001 },
    ] as any;
    state.context.compression = {
      anchor: 1,
      summary: 'Previous conversation about X',
    };
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = assembler.build(state, opts);

    // Should include compression summary
    const summaryMsg = messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('Conversation History Summary')
    );
    expect(summaryMsg!.content).toContain('Previous conversation about X');

    // Should only include messages from anchor index onwards
    const userMessages = messages.filter(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content === 'new msg'
    );
    expect(userMessages).toHaveLength(1);

    // Old message should not appear
    const oldMsg = messages.find(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content === 'old msg'
    );
    expect(oldMsg).toBeUndefined();
  });

  it('section order in static prefix is: Instructions → Skills → Sub-Agents → Thinking', () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const subAgentMap = new Map();
    subAgentMap.set('agent1', { name: 'agent1', description: 'An agent' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      skillProvider: {
        listSkills: () => [{ name: 'test', description: 'A skill' }],
      } as any,
      subAgentConfigs: subAgentMap,
      enablePromptThinking: true,
    });

    const messages = assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    const instructionsIdx = content.indexOf('## Instructions');
    const skillsIdx = content.indexOf('## Available Skills');
    const subAgentsIdx = content.indexOf('## Sub-Agents');
    const thinkingIdx = content.indexOf('## Thinking');

    expect(instructionsIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeGreaterThan(instructionsIdx);
    expect(subAgentsIdx).toBeGreaterThan(skillsIdx);
    expect(thinkingIdx).toBeGreaterThan(subAgentsIdx);
  });

  describe('Thought message handling', () => {
    it('should include same-turn thought in output messages', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        { role: 'user', content: 'Hello', timestamp: 1000 },
        {
          role: 'assistant',
          type: 'thought',
          content: 'Let me think about this...',
          timestamp: 1001,
        },
        { role: 'assistant', content: 'Hi there!', timestamp: 1002 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);

      // Same-turn thought (after last user) should appear as assistant message
      const hasThought = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Let me think about this...')
      );
      expect(hasThought).toBe(true);

      // Non-thought assistant message should also be present
      const hasReply = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Hi there!')
      );
      expect(hasReply).toBe(true);
    });

    it('should skip cross-turn thought messages', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        {
          role: 'assistant',
          type: 'thought',
          content: 'Old thinking from previous turn...',
          timestamp: 1000,
        },
        { role: 'user', content: 'Hello', timestamp: 1001 },
        { role: 'assistant', content: 'Hi there!', timestamp: 1002 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);

      // Cross-turn thought (before last user) should NOT appear
      const hasOldThought = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some(
            (c: any) => c.type === 'text' && c.text === 'Old thinking from previous turn...'
          )
      );
      expect(hasOldThought).toBe(false);
    });

    it('should include multiple same-turn thoughts', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        { role: 'user', content: 'Solve this', timestamp: 1000 },
        { role: 'assistant', type: 'thought', content: 'Thinking step 1...', timestamp: 1001 },
        {
          role: 'assistant',
          content: 'Reading file...',
          toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: { path: '/tmp/a' } }],
          timestamp: 1002,
        },
        {
          role: 'tool',
          content: 'file contents',
          toolCallId: 'tc-1',
          toolName: 'read_file',
          timestamp: 1003,
        },
        { role: 'assistant', type: 'thought', content: 'Thinking step 2...', timestamp: 1004 },
        { role: 'assistant', content: 'Here is the answer.', timestamp: 1005 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);

      const hasThought1 = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Thinking step 1...')
      );
      const hasThought2 = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Thinking step 2...')
      );
      expect(hasThought1).toBe(true);
      expect(hasThought2).toBe(true);
    });

    it('should handle mixed same-turn and cross-turn thoughts', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        {
          role: 'assistant',
          type: 'thought',
          content: 'Old thinking from before...',
          timestamp: 1000,
        },
        { role: 'user', content: 'New request', timestamp: 1001 },
        {
          role: 'assistant',
          type: 'thought',
          content: 'Fresh thinking...',
          timestamp: 1002,
        },
        { role: 'assistant', content: 'Done.', timestamp: 1003 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);

      const hasOldThought = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Old thinking from before...')
      );
      expect(hasOldThought).toBe(false);

      const hasNewThought = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Fresh thinking...')
      );
      expect(hasNewThought).toBe(true);
    });

    it('should include same-turn thought even when it is the last message', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        { role: 'user', content: 'What is 2+2?', timestamp: 1000 },
        {
          role: 'assistant',
          type: 'thought',
          content: 'Calculating the sum...',
          timestamp: 1001,
        },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);

      const hasThought = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Calculating the sum...')
      );
      expect(hasThought).toBe(true);
    });

    it('should preserve regular assistant messages when no thoughts exist', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        { role: 'user', content: 'Hello', timestamp: 1000 },
        { role: 'assistant', content: 'Hi!', timestamp: 1001 },
        { role: 'user', content: 'How are you?', timestamp: 1002 },
        { role: 'assistant', content: 'Fine!', timestamp: 1003 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);

      // System ack + 2 conversation assistant messages
      const assistantMsgs = messages.filter((m) => m.role === 'assistant');
      expect(assistantMsgs).toHaveLength(3); // ack + Hi! + Fine!
    });
  });

  describe('Dynamic content extraction to system-reminder', () => {
    it('should NOT include ## Current Task List in static system doc', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      (state.context as any).todoList = {
        items: [
          { id: 1, subject: 'Task A', status: 'pending', description: undefined, blockedBy: [] },
        ],
        nextId: 2,
      };
      state.context.messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);
      const systemMsg = messages[0];
      const content = typeof systemMsg?.content === 'string' ? systemMsg.content : '';

      // Static prefix should NOT contain todolist
      expect(content).not.toContain('## Current Task List');
      expect(content).not.toContain('Task A');
    });

    it('should inject todolist in system-reminder of last user message', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      (state.context as any).todoList = {
        items: [
          { id: 1, subject: 'Task A', status: 'pending', description: undefined, blockedBy: [] },
          {
            id: 2,
            subject: 'Task B',
            status: 'in_progress',
            description: undefined,
            blockedBy: [],
          },
        ],
        nextId: 3,
      };
      state.context.messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('<system-reminder>');
      expect(content).toContain('## Task List');
      expect(content).toContain('- [ ] 1. Task A');
      expect(content).toContain('- [~] 2. Task B');
      expect(content).toContain('</system-reminder>');
    });

    it('should NOT inject active skill in system-reminder (instructions persist in history)', () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      (state.context as any).skillState = {
        current: 'search',
        stack: [],
      };
      state.context.messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = assembler.build(state, opts);
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      // No active skill is injected — instructions now live in conversation history
      expect(content).not.toContain('## Active Skill');
      expect(content).not.toContain('return_skill');
    });
  });
});
