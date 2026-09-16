import { describe, it, expect, vi, afterEach } from 'vitest';
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
  it('emits only the tail reminder when no static parts exist (reminder is always present)', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState();
    const opts = makeOpts();
    const messages = await assembler.build(state, opts);

    // No system doc → the always-on dynamic tail reminder is the only message
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';
    expect(content.startsWith('<system-reminder>\nTime: ')).toBe(true);
  });

  it('produces YAML frontmatter at position 0 with no prefix', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\ntz: UTC\n---',
    });

    const messages = await assembler.build(state, opts);
    const firstUser = messages.find((m) => m.role === 'user');
    const content = typeof firstUser!.content === 'string' ? firstUser!.content : '';

    // YAML frontmatter at position 0, no [System Instructions] prefix
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).not.toContain('[System Instructions]');
  });

  it('wraps instructions in ## Instructions with heading shift', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({
      instructions: '# My Agent\n\n## Section\n\nDo things.',
    });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
    });

    const messages = await assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Instructions');
    // Original # → ### (shifted by 2)
    expect(content).toContain('### My Agent');
    // Original ## → #### (shifted by 2)
    expect(content).toContain('#### Section');
  });

  it('does not produce ## Instructions when no instructions given', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState();
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
    });

    const messages = await assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).not.toContain('## Instructions');
  });

  it('produces ## Available Skills when skill provider has skills', async () => {
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

    const messages = await assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Available Skills');
    expect(content).toContain('- search: Search the web');
    expect(content).toContain('- code: Write code');
    expect(content).toContain('load_skill');
  });

  it('does not produce ## Available Skills when no skill provider', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = await assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).not.toContain('## Available Skills');
  });

  it('produces ## Sub-Agents when sub-agents configured', async () => {
    const subAgentMap = new Map();
    subAgentMap.set('coder', {
      name: 'coder',
      description: 'Writes code',
    });
    const assembler = new MarkdownMessageAssembler(subAgentMap);
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
    });

    const messages = await assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Sub-Agents');
    expect(content).toContain('- coder: Writes code');
    expect(content).toContain('delegate');
  });

  it('produces ## Thinking when enablePromptThinking is true', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      enablePromptThinking: true,
    });

    const messages = await assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).toContain('## Thinking');
    expect(content).toContain('<think>');
  });

  it('does not produce ## Thinking when enablePromptThinking is false', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      enablePromptThinking: false,
    });

    const messages = await assembler.build(state, opts);
    const content = typeof messages[0].content === 'string' ? messages[0].content : '';

    expect(content).not.toContain('## Thinking');
  });

  it('adds fake assistant acknowledgment after system doc', async () => {
    const assembler = new MarkdownMessageAssembler();
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

    const messages = await assembler.build(state, opts);

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

  it('includes conversation history after system doc', async () => {
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

    const messages = await assembler.build(state, opts);

    // System doc (user) + ack (assistant) + user msg + assistant msg
    // + always-on dynamic tail reminder
    expect(messages).toHaveLength(5);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Hello');
    expect(messages[3].role).toBe('assistant');
  });

  it('handles tool messages in conversation history', async () => {
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

    const messages = await assembler.build(state, opts);

    const toolMsg = messages.find((m) => m.role === 'toolResult');
    expect(toolMsg!.toolCallId).toBe('tc-1');
    expect(toolMsg!.isError).toBe(false);
  });

  it('marks tool result as error when content starts with Error:', async () => {
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

    const messages = await assembler.build(state, opts);

    const toolMsg = messages.find((m) => m.role === 'toolResult' && m.toolCallId === 'tc-2');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.isError).toBe(true);
  });

  it('creates an assistant message when input has toolCalls', async () => {
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

    const messages = await assembler.build(state, opts);

    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(2);
    const assistantMsg = assistantMsgs[1];
    expect(Array.isArray(assistantMsg.content)).toBe(true);
  });

  it('includes tool call details in assistant message content', async () => {
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

    const messages = await assembler.build(state, opts);
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

  it('sets stopReason to toolUse for assistant messages with toolCalls', async () => {
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

    const messages = await assembler.build(state, opts);
    const assistantMsg = messages.filter((m) => m.role === 'assistant')[1];

    expect(assistantMsg.stopReason).toBe('toolUse');
  });

  it('handles assistant messages without toolCalls', async () => {
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

    const messages = await assembler.build(state, opts);

    const assistantMsgs = messages.filter((m) => m.role === 'assistant');
    expect(assistantMsgs).toHaveLength(2);
    const assistantMsg = assistantMsgs[1];
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    expect(assistantMsg.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Just a reply.' })])
    );
    expect(assistantMsg.stopReason).toBe('stop');
  });

  it('respects compression boundary', async () => {
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

    const messages = await assembler.build(state, opts);

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

  it('section order in static prefix is: Instructions → Skills → Sub-Agents → Thinking', async () => {
    const subAgentMap = new Map();
    subAgentMap.set('agent1', { name: 'agent1', description: 'An agent' });
    const assembler = new MarkdownMessageAssembler(subAgentMap);
    const state = makeState({ instructions: 'Be helpful.' });
    const opts = makeOpts({
      systemPrompt: '---\ntime: now\n---',
      skillProvider: {
        listSkills: () => [{ name: 'test', description: 'A skill' }],
      } as any,
      enablePromptThinking: true,
    });

    const messages = await assembler.build(state, opts);
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
    it('should include same-turn thought in output messages', async () => {
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

      const messages = await assembler.build(state, opts);

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

    it('should skip cross-turn thought messages', async () => {
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

      const messages = await assembler.build(state, opts);

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

    it('should include multiple same-turn thoughts', async () => {
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

      const messages = await assembler.build(state, opts);

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

    it('should handle mixed same-turn and cross-turn thoughts', async () => {
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

      const messages = await assembler.build(state, opts);

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

    it('should include same-turn thought even when it is the last message', async () => {
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

      const messages = await assembler.build(state, opts);

      const hasThought = messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === 'text' && c.text === 'Calculating the sum...')
      );
      expect(hasThought).toBe(true);
    });

    it('should preserve regular assistant messages when no thoughts exist', async () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        { role: 'user', content: 'Hello', timestamp: 1000 },
        { role: 'assistant', content: 'Hi!', timestamp: 1001 },
        { role: 'user', content: 'How are you?', timestamp: 1002 },
        { role: 'assistant', content: 'Fine!', timestamp: 1003 },
      ] as any;
      const opts = makeOpts({ systemPrompt: '---\ntime: now\n---' });

      const messages = await assembler.build(state, opts);

      // System ack + 2 conversation assistant messages
      const assistantMsgs = messages.filter((m) => m.role === 'assistant');
      expect(assistantMsgs).toHaveLength(3); // ack + Hi! + Fine!
    });
  });

  describe('Dynamic content extraction to system-reminder', () => {
    it('should NOT include ## Current Task List in static system doc', async () => {
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

      const messages = await assembler.build(state, opts);
      const systemMsg = messages[0];
      const content = typeof systemMsg?.content === 'string' ? systemMsg.content : '';

      // Static prefix should NOT contain todolist
      expect(content).not.toContain('## Current Task List');
      expect(content).not.toContain('Task A');
    });

    it('should inject todolist in the standalone tail system-reminder message', async () => {
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

      const messages = await assembler.build(state, opts);
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      expect(content).toContain('<system-reminder>');
      expect(content).toContain('## Task List');
      expect(content).toContain('- [ ] 1. Task A');
      expect(content).toContain('- [~] 2. Task B');
      expect(content).toContain('</system-reminder>');
    });

    it('tail reminder carries only the time line when todo is disabled (time awareness survives)', async () => {
      // 对齐 Rust reminder_time_line_without_todo:todo 关闭(undefined)时
      // 仅时间行,无 Task List 小节。
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
      ] as any;
      const opts = makeOpts({ systemPrompt: 'sys' });

      const messages = await assembler.build(state, opts);
      const last = messages[messages.length - 1];
      expect(last.role).toBe('user');
      const lastText = typeof last.content === 'string' ? last.content : '';
      expect(lastText.startsWith('<system-reminder>\nTime: ')).toBe(true);
      expect(lastText).not.toContain('## Task List');
    });

    it('tail reminder injects the empty-list icebreaker nudge when todo is enabled but empty', async () => {
      // 对齐 Rust 冷启动破冰:空列表注入一行使用引导(工具名按 TS 侧注册名)。
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      (state.context as any).todoList = { items: [], nextId: 1 };
      state.context.messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
      ] as any;
      const opts = makeOpts({ systemPrompt: 'sys' });

      const messages = await assembler.build(state, opts);
      const lastText =
        typeof messages[messages.length - 1].content === 'string'
          ? (messages[messages.length - 1].content as string)
          : '';
      expect(lastText).toContain(
        '## Task List\n(no tasks yet — for multi-step work, create tasks with the todolist tool)'
      );
    });

    it('legacy reminder row before any user message becomes a standalone user message (defensive)', async () => {
      // 对齐 Rust build_messages_reminder_without_preceding_user_becomes_standalone。
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        {
          role: 'system',
          id: '1',
          type: 'system-reminder',
          content: 'Time: X',
          timestamp: 1000,
        },
      ] as any;
      const opts = makeOpts({ systemPrompt: 'sys' });

      const messages = await assembler.build(state, opts);

      const standalone = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('Time: X')
      );
      expect(standalone).toBeDefined();
      // 不带 "\n\n---\n" 前缀(独立成消息时剥掉)
      expect(standalone!.content).toBe('<system-reminder>\nTime: X\n</system-reminder>');
      // 其后恒有动态尾部提醒(时间行)——两者不混淆
      const last = messages[messages.length - 1];
      expect(last).not.toBe(standalone);
      const lastText = typeof last.content === 'string' ? last.content : '';
      expect(lastText.startsWith('<system-reminder>\nTime: ')).toBe(true);
    });

    it('should NOT inject active skill in system-reminder (instructions persist in history)', async () => {
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

      const messages = await assembler.build(state, opts);
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const content = typeof lastUser?.content === 'string' ? lastUser.content : '';

      // No active skill is injected — instructions now live in conversation history
      expect(content).not.toContain('## Active Skill');
      expect(content).not.toContain('return_skill');
    });
  });

  // ── 前缀缓存断点修复（R2P-101w，对齐 Rust 5120a3e/5e238bc/1f08b1f 的
  // build_messages 系列：时间挪尾 + todo 独立尾部 + legacy reminder 合并 +
  // sub-agents 目录确定性）。时间行的位置与格式是缓存的结构属性——分钟级
  // 时间戳在头部时，>1min 间隔的请求即断掉整个 provider 前缀缓存。
  describe('prefix-cache breakpoint fixes (R2P-101w)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Strip timestamps: cache comparison cares about role+content (the wire), not Date.now() stamps */
    const wireView = (messages: Awaited<ReturnType<MarkdownMessageAssembler['build']>>) =>
      messages.map((m) => ({ role: m.role, content: m.content }));

    function makeTodoState(): AgentState {
      const state = makeState({ instructions: 'Be helpful.' });
      state.context.messages = [
        { role: 'user', id: '1', content: 'Do tasks', type: 'text', timestamp: 1000 },
      ] as any;
      return state;
    }

    it('1. system doc header carries no minute-level timestamp (byte-identical across builds >1min apart)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const assembler = new MarkdownMessageAssembler();

      const buildHeader = async () => {
        const state = makeState({ instructions: 'Be helpful.' });
        state.context.messages = [
          { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
        ] as any;
        const opts = makeOpts({ systemPrompt: '---\nname: test\n---' });
        const messages = await assembler.build(state, opts);
        return typeof messages[0].content === 'string' ? messages[0].content : '';
      };

      vi.setSystemTime(new Date('2026-05-13T10:06:00'));
      const first = await buildHeader();
      vi.setSystemTime(new Date('2026-05-13T10:09:30')); // >1min later
      const second = await buildHeader();

      // 头部是静态的：无分钟级时间行（Time/Timezone 由尾部 reminder 现算）
      expect(first).not.toMatch(/Time:|Timezone:|\d{2}:\d{2}/);
      // 两次构建逐字节一致
      expect(second).toBe(first);
    });

    it('2. tail dynamic reminder is always present with Time: as first line; only the tail block differs across >1min builds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const assembler = new MarkdownMessageAssembler();

      const build = async () => {
        const state = makeTodoState();
        (state.context as any).todoList = {
          items: [{ id: 1, subject: 'Task A', status: 'pending' }],
          nextId: 2,
        };
        const opts = makeOpts({ systemPrompt: 'sys' });
        return assembler.build(state, opts);
      };

      vi.setSystemTime(new Date('2026-05-13T10:06:00'));
      const first = await build();
      vi.setSystemTime(new Date('2026-05-13T10:09:30')); // >1min later
      const second = await build();

      // reminder 恒有：时间行为 reminder 块的首行
      const tail1 = first[first.length - 1];
      expect(tail1.role).toBe('user');
      const tailText1 = typeof tail1.content === 'string' ? tail1.content : '';
      expect(tailText1.startsWith('<system-reminder>\nTime: ')).toBe(true);
      expect(tailText1.endsWith('\n</system-reminder>')).toBe(true);

      // 除尾部 reminder 块外，消息序列逐字节一致
      expect(wireView(second.slice(0, -1))).toEqual(wireView(first.slice(0, -1)));

      // 尾部时间行确实现算（分钟变了）
      const tailText2 =
        typeof second[second.length - 1].content === 'string'
          ? (second[second.length - 1].content as string)
          : '';
      expect(tailText2).not.toBe(tailText1);
    });

    it('3. todo reminder is a standalone tail message, not a suffix on the last persisted user message', async () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeTodoState();
      (state.context as any).todoList = {
        items: [
          { id: 1, subject: 'Task A', status: 'pending' },
          { id: 2, subject: 'Task B', status: 'in_progress' },
        ],
        nextId: 3,
      };
      const opts = makeOpts({ systemPrompt: 'sys' });

      const messages = await assembler.build(state, opts);

      // 落盘 user 消息保持原文（suffix 进它是前缀缓存断点：下一轮请求里这条消息是原文）
      const persisted = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string' && m.content === 'Do tasks'
      );
      expect(persisted).toBeDefined();

      // todo 提醒独立成最后一条 user 消息，时间行与任务清单同块
      const last = messages[messages.length - 1];
      expect(last.role).toBe('user');
      const lastText = typeof last.content === 'string' ? last.content : '';
      expect(lastText.startsWith('<system-reminder>\nTime: ')).toBe(true);
      expect(lastText).toContain('## Task List');
      expect(lastText).toContain('- [ ] 1. Task A');
      expect(lastText).toContain('- [~] 2. Task B');
      expect(lastText).not.toContain('Do tasks');
    });

    it('4. legacy system-reminder rows merge into the preceding user message tail byte-stably; persisted originals stay untouched', async () => {
      const assembler = new MarkdownMessageAssembler();
      const state = makeState({ instructions: 'Be helpful.' });
      const legacyRow = '---\nTime: Monday, 25/08/2026, 10:00\nTimezone: +08:00\n---';
      state.context.messages = [
        { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
        {
          role: 'system',
          id: '2',
          type: 'system-reminder',
          content: legacyRow,
          timestamp: 1001,
        },
        { role: 'assistant', id: '3', content: 'Hi', type: 'text', timestamp: 1002 },
        // 普通系统标记行：不进 LLM 上下文
        { role: 'system', id: '4', content: '{"kind":"compact"}', timestamp: 1003 },
      ] as any;
      const opts = makeOpts({ systemPrompt: 'sys' });

      const messages = await assembler.build(state, opts);

      // 存量兼容：按原样合并进前一条 user 消息的 <system-reminder> 尾巴
      // —— 位置与内容逐字节稳定，旧会话的前缀缓存照常命中。
      const hello = messages.find(
        (m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('Hello')
      );
      expect(hello).toBeDefined();
      expect(hello!.content).toBe(
        'Hello\n\n---\n<system-reminder>\n' + legacyRow + '\n</system-reminder>'
      );

      // 落盘原文不动（合并只发生在请求构建物上）
      expect(state.context.messages[0].content).toBe('Hello');
      expect(state.context.messages[1].content).toBe(legacyRow);

      // 普通标记行不出现
      expect(JSON.stringify(messages)).not.toContain('compact');
    });

    it('5. sub-agents catalog is deterministic across builds regardless of Map insertion order (code-unit sorted)', async () => {
      const makeAssembler = (insertOrder: string[]) => {
        const map = new Map<string, { name: string; description: string }>();
        for (const name of insertOrder) {
          map.set(name, { name, description: `Agent ${name}` });
        }
        return new MarkdownMessageAssembler(map as never);
      };

      const buildDoc = async (assembler: MarkdownMessageAssembler) => {
        const state = makeState({ instructions: 'Be helpful.' });
        state.context.messages = [
          { role: 'user', id: '1', content: 'Hello', type: 'text', timestamp: 1000 },
        ] as any;
        const opts = makeOpts({ systemPrompt: 'sys' });
        const messages = await assembler.build(state, opts);
        return typeof messages[0].content === 'string' ? messages[0].content : '';
      };

      // 两种插入序（'Midnight' 首字母 M < a < z，code-unit 序与插入序都不同）
      const docA = await buildDoc(makeAssembler(['zeta', 'alpha', 'Midnight']));
      const docB = await buildDoc(makeAssembler(['Midnight', 'zeta', 'alpha']));

      // 跨构建同输出：目录段逐字节一致
      expect(docB).toBe(docA);

      // 排序按 name 的 UTF-16 code unit（'Midnight' < 'alpha' < 'zeta'，
      // 大写 M=0x4D 排在小写 a=0x61 之前），非插入序、非 locale 排序
      expect(docA.indexOf('- Midnight: Agent Midnight')).toBeGreaterThan(-1);
      expect(docA.indexOf('- Midnight:')).toBeLessThan(docA.indexOf('- alpha:'));
      expect(docA.indexOf('- alpha:')).toBeLessThan(docA.indexOf('- zeta:'));
    });
  });
});
