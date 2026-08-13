/**
 * Integration Test: LLM tool calling with builtin tools
 *
 * Tests the full agent loop with real LLM:
 * 1. Can the LLM choose the right tool at the right time?
 * 2. Does the tool execute correctly?
 * 3. Is the result correct?
 * 4. Can the LLM understand the tool result in the next turn?
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuiltinTools } from '../../src/tools/builtin/index.js';

const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true';
const apiKey = process.env.OPENAI_API_KEY || '';
const provider = process.env.PROVIDER || 'openai';
const baseUrl = process.env.OPENAI_BASE_URL;
const testModel = process.env.MODEL || 'gpt-3.5-turbo';
const itif = (condition: boolean) => (condition ? it : it.skip);

function makeRunner(tools: ReturnType<typeof createBuiltinTools>) {
  return new AgentRunner({
    model: testModel,
    llmClient: LLMClient.quickInit({
      providers: [
        {
          name: provider,
          apiKey,
          baseUrl,
          models: [{ modelId: testModel }],
        },
      ],
    }),
    tools,
  });
}

describe('LLM tool calling: builtin tools', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-llm-test-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  });

  itif(enabled)(
    'file_write + file_read: LLM writes a file then reads it back',
    async () => {
      await writeFile(
        join(workspace, 'existing.txt'),
        'Hello from existing file\nLine 2\nLine 3\n'
      );

      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      let state = createAgentState({
        name: 'file-agent',
        instructions:
          'You are a file assistant. Use tools to accomplish tasks. After reading or writing files, report the content you saw or wrote.',
        tools: [],
      });

      state = addUserMessage(
        state,
        'Please do two things in order: 1) Read the file existing.txt and tell me what is in it. 2) Create a new file called report.txt with content "File read successfully".'
      );

      const { state: finalState, result } = await runner.run(state);

      // 1+2: Did the LLM call the right tools? Did they execute?
      expect(result.type).toBe('success');

      // 3: Is the result correct? (file written to disk)
      const reportContent = await readFile(join(workspace, 'report.txt'), 'utf8').catch(() => null);
      expect(typeof reportContent).toBe('string');
      expect(reportContent!.toLowerCase()).toContain('file read successfully');

      // 4: Did the LLM understand the tool results?
      const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      expect(lastAssistant).toHaveProperty('content');
      const responseText =
        typeof lastAssistant!.content === 'string'
          ? lastAssistant!.content
          : JSON.stringify(lastAssistant!.content);
      expect(responseText.toLowerCase()).toContain('existing');
    },
    180000
  );

  itif(enabled)(
    'file_edit: LLM edits a file by replacing specific text',
    async () => {
      await writeFile(
        join(workspace, 'config.json'),
        '{\n  "name": "my-app",\n  "version": "1.0.0"\n}'
      );

      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      let state = createAgentState({
        name: 'edit-agent',
        instructions:
          'You are a code editing assistant. Use the file_edit tool to make precise replacements. Always confirm what you changed.',
        tools: [],
      });

      state = addUserMessage(
        state,
        'Edit config.json to change the version from "1.0.0" to "2.0.0". Then confirm what you changed.'
      );

      const { result } = await runner.run(state);
      expect(result.type).toBe('success');

      // Verify file was edited on disk
      const edited = await readFile(join(workspace, 'config.json'), 'utf8');
      expect(edited).toContain('2.0.0');
      expect(edited).not.toContain('1.0.0');
      expect(edited).toContain('my-app');
    },
    180000
  );

  itif(enabled)(
    'glob + grep: LLM searches for files and content',
    async () => {
      await mkdir(join(workspace, 'src'), { recursive: true });
      await writeFile(
        join(workspace, 'src', 'user.ts'),
        'export function getUser(id: string) {\n  return db.find(id);\n}'
      );
      await writeFile(
        join(workspace, 'src', 'product.ts'),
        'export function getProduct(id: string) {\n  return db.find(id);\n}'
      );
      await writeFile(
        join(workspace, 'src', 'utils.ts'),
        'export function formatDate(d: Date) {\n  return d.toISOString();\n}'
      );
      await writeFile(join(workspace, 'package.json'), '{"name": "test-project"}');

      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      let state = createAgentState({
        name: 'search-agent',
        instructions:
          'You are a code search assistant. Use glob to find files and grep to search content. Report your findings clearly.',
        tools: [],
      });

      state = addUserMessage(
        state,
        'Find all TypeScript files in the project, then search for the function "getUser". Tell me which file contains it and what line it is on.'
      );

      const { state: finalState, result } = await runner.run(state);
      expect(result.type).toBe('success');

      const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
      const lastMsg = assistantMessages[assistantMessages.length - 1];
      const responseText =
        typeof lastMsg!.content === 'string' ? lastMsg!.content : JSON.stringify(lastMsg!.content);
      expect(responseText.toLowerCase()).toContain('user');
    },
    180000
  );

  itif(enabled)(
    'web_fetch: LLM fetches a URL and summarizes content',
    async () => {
      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      let state = createAgentState({
        name: 'web-agent',
        instructions:
          'You are a web research assistant. Use web_fetch to retrieve web pages and summarize their content.',
        tools: [],
      });

      state = addUserMessage(
        state,
        'Fetch the URL https://httpbin.org/json and tell me what data is in the response.'
      );

      const { state: finalState, result } = await runner.run(state);
      expect(result.type).toBe('success');

      const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
      const lastMsg = assistantMessages[assistantMessages.length - 1];
      const responseText =
        typeof lastMsg!.content === 'string' ? lastMsg!.content : JSON.stringify(lastMsg!.content);
      expect(responseText.length).toBeGreaterThan(20);
    },
    180000
  );

  itif(enabled)(
    'multi-tool workflow: LLM uses file_read + file_write in sequence',
    async () => {
      await writeFile(join(workspace, 'data.txt'), 'apple\nbanana\ncherry\ndate\nelderberry');

      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      let state = createAgentState({
        name: 'workflow-agent',
        instructions:
          'You are an automation assistant. Follow user instructions step by step using the available tools.',
        tools: [],
      });

      state = addUserMessage(
        state,
        'Do these steps: 1) Read data.txt, 2) Count how many lines it has, 3) Create a new file called summary.txt with content "The file has N items" where N is the actual count, 4) Read summary.txt to confirm it was written correctly.'
      );

      const { result } = await runner.run(state);
      expect(result.type).toBe('success');

      const summary = await readFile(join(workspace, 'summary.txt'), 'utf8').catch(() => null);
      expect(typeof summary).toBe('string');
      expect(summary!.toLowerCase()).toContain('5');
    },
    180000
  );
});
