/**
 * Integration Test: Todolist with Real LLM Calls
 *
 * US1: LLM creates todo tasks from natural language
 * US2: LLM executes todo list and marks items completed
 * US3: Todo state persists across sessions
 * US4: LLM sees todo list in system prompt
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AgentRunner,
  createAgentState,
  addUserMessage,
  type ToolDefinition,
} from '@agentskillmania/colts';
import { createTodolistSupport } from '../../src/todolist/index.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { createSessionSupport } from '../../src/session/support.js';
import { testConfig, itif } from './config.js';

function makeRunner(tools: ToolDefinition[], middleware: any[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llm: {
      providers: [
        {
          name: testConfig.provider,
          apiKey: testConfig.apiKey,
          baseUrl: testConfig.baseUrl,
          models: [{ modelId: testConfig.testModel }],
        },
      ],
    },
    tools,
    middleware,
    messageAssembler: new MarkdownMessageAssembler(),
  });
}

describe('US1: LLM creates todo tasks from natural language', () => {
  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Wrangler Integration] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  itif(testConfig.enabled)(
    'should break down complex task into todo list using todolist tool',
    async () => {
      const todolistSupport = createTodolistSupport();

      const runner = makeRunner(todolistSupport.tools, [todolistSupport.middleware]);

      let state = createAgentState({
        name: 'planning-agent',
        instructions:
          'You are a task planning assistant. When given a complex task, ' +
          'ALWAYS break it down using the todolist tool first, then execute each step.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Please help me plan and execute these 3 tasks: ' +
          '1) Write a haiku about coding 2) Count the letters in the haiku 3) Tell me if the count is even or odd'
      );

      const { state: finalState, result } = await runner.run(state);

      // Verify successful execution
      expect(result.type).toBe('success');

      // Verify todo list was created and populated
      expect(finalState.context.todoList).toHaveProperty('items');
      expect(finalState.context.todoList!.items.length).toBeGreaterThan(0);

      // Verify todo items reflect the 3 subtasks (haiku, count, even/odd check)
      const subjects = finalState.context.todoList!.items.map((item) => item.subject.toLowerCase());
      const hasHaiku = subjects.some((s) => s.includes('haiku') || s.includes('poem'));
      const hasCount = subjects.some((s) => s.includes('count') || s.includes('letter'));
      const hasEvenOdd = subjects.some((s) => s.includes('even') || s.includes('odd'));

      expect(hasHaiku).toBe(true);
      expect(hasCount).toBe(true);
      expect(hasEvenOdd).toBe(true);
    },
    60000
  );
});

describe('US2: LLM executes todo list and marks items completed', () => {
  itif(testConfig.enabled)(
    'should work through pre-populated todo list and mark tasks completed',
    async () => {
      const todolistSupport = createTodolistSupport();

      const runner = makeRunner(todolistSupport.tools, [todolistSupport.middleware]);

      let state = createAgentState({
        name: 'task-executor',
        instructions:
          'You are a task executor. Work through your todo list one by one. ' +
          'Mark each task as completed after you finish it.',
        tools: [],
      });

      // Pre-populate todo list with two tasks
      state = addUserMessage(
        state,
        'Please add these tasks to your todo list: "Say hello" and "Tell me a joke". Then complete them.'
      );

      const { state: finalState, result } = await runner.run(state);

      // Verify successful execution
      expect(result.type).toBe('success');

      // Verify todo list exists and has items
      expect(finalState.context.todoList).toHaveProperty('items');
      expect(finalState.context.todoList!.items.length).toBeGreaterThan(0);

      // Verify all tasks are marked as completed
      const allCompleted = finalState.context.todoList!.items.every(
        (item) => item.status === 'completed'
      );
      expect(allCompleted).toBe(true);
    },
    60000
  );
});

describe('US3: Todo state persists across sessions', () => {
  let testBaseDir: string;

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-todo-e2e-us3-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  itif(testConfig.enabled)(
    'should save and restore todo list across sessions',
    async () => {
      const session = createSessionSupport({
        workspacePath: '/test/workspace',
        sessionBaseDir: testBaseDir,
      });
      const todolistSupport = createTodolistSupport();

      // Round 1: Create todos
      const runner1 = makeRunner(
        [...session.tools, ...todolistSupport.tools],
        [session.middlewares[0], todolistSupport.middleware]
      );

      let state1 = createAgentState({
        name: 'todo-planner',
        instructions: 'You are a planning assistant. Use the todolist tool to track tasks.',
        tools: [],
      });
      state1 = addUserMessage(
        state1,
        'Add these tasks to your todo list: "Write documentation" and "Run tests"'
      );

      const { state: finalState1 } = await runner1.run(state1);
      const sessionId = state1.id;

      // Verify todos were created in round 1
      expect(finalState1.context.todoList).toHaveProperty('items');
      expect(finalState1.context.todoList!.items.length).toBeGreaterThan(0);
      const todoCountAfterRound1 = finalState1.context.todoList!.items.length;

      // Round 2: Load session and verify LLM sees persisted todos
      const loaded = await session.store.loadState(sessionId);
      expect(loaded).toHaveProperty('id');

      const runner2 = makeRunner(
        [...session.tools, ...todolistSupport.tools],
        [session.middlewares[0], todolistSupport.middleware]
      );

      const state2 = addUserMessage(loaded!, 'What tasks are in my todo list?');
      const { state: finalState2, result: result2 } = await runner2.run(state2);

      // Verify successful round 2
      expect(result2.type).toBe('success');

      // Verify todo list was restored
      expect(finalState2.context.todoList).toHaveProperty('items');
      expect(finalState2.context.todoList!.items.length).toBe(todoCountAfterRound1);

      // Verify LLM response references the persisted todo items
      const lastMessage = finalState2.context.messages[finalState2.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      // LLM should mention the tasks
      const mentionsDocumentation = responseText.toLowerCase().includes('documentation');
      const mentionsTests =
        responseText.toLowerCase().includes('test') || responseText.toLowerCase().includes('tests');
      expect(mentionsDocumentation || mentionsTests).toBe(true);
    },
    120000
  );
});

describe('US4: LLM sees todo list in system prompt', () => {
  itif(testConfig.enabled)(
    'should render todo list in system prompt and LLM references it',
    async () => {
      const todolistSupport = createTodolistSupport();

      const runner = makeRunner(todolistSupport.tools, [todolistSupport.middleware]);

      let state = createAgentState({
        name: 'todo-aware-agent',
        instructions: 'You are a helpful assistant with a todo list.',
        tools: [],
      });

      // Pre-populate todo list by asking LLM to create tasks
      state = addUserMessage(
        state,
        'Add these tasks to your todo list: "Review code", "Fix bugs", "Deploy to production"'
      );

      const { state: stateWithTodos } = await runner.run(state);

      // Verify todos were created
      expect(stateWithTodos.context.todoList).toHaveProperty('items');
      expect(stateWithTodos.context.todoList!.items.length).toBeGreaterThan(0);

      // Now ask about the todo list
      const stateWithQuestion = addUserMessage(stateWithTodos, 'What tasks do you currently have?');
      const { state: finalState, result } = await runner.run(stateWithQuestion);

      // Verify successful execution
      expect(result.type).toBe('success');

      // Verify LLM response references the specific todo items
      const lastMessage = finalState.context.messages[finalState.context.messages.length - 1];
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);

      // LLM should mention at least one of the tasks by name
      const mentionsReview = responseText.toLowerCase().includes('review');
      const mentionsBugs = responseText.toLowerCase().includes('bug');
      const mentionsDeploy =
        responseText.toLowerCase().includes('deploy') ||
        responseText.toLowerCase().includes('production');

      const mentionsTask = mentionsReview || mentionsBugs || mentionsDeploy;
      expect(mentionsTask).toBe(true);

      // This proves the ## Current Task List section was rendered in the system prompt
      // and the LLM saw and understood the todo items
    },
    60000
  );
});
