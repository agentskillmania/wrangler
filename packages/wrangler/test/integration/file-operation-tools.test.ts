/**
 * User Story: LLM uses file operation tools end-to-end
 *
 * As a developer, I want the LLM to correctly use file operation tools
 * (file_read, file_write, file_edit, glob, grep) to perform real file operations
 * in a workspace directory.
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  AgentRunner,
  createAgentState,
  addUserMessage,
  type ToolDefinition,
} from '@agentskillmania/colts';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBuiltinTools } from '../../src/tools/builtin/index.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { testConfig, itif } from './config.js';

function makeRunner(tools: ToolDefinition[]) {
  return new AgentRunner({
    model: testConfig.testModel,
    llm: {
      apiKey: testConfig.apiKey,
      provider: testConfig.provider,
      baseUrl: testConfig.baseUrl,
    },
    tools,
    middleware: [],
    messageAssembler: new MarkdownMessageAssembler(),
  });
}

describe('File Operation Tools E2E', () => {
  let workspace: string;

  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Wrangler Integration] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  beforeEach(async () => {
    workspace = join(tmpdir(), `wrangler-file-intg-${Date.now()}`);
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  /**
   * US1: LLM reads a file and answers questions about it
   *
   * Given a file with known content in the workspace
   * When I ask the LLM to read it and extract specific information
   * Then the LLM should correctly use file_read and provide the right answer
   */
  itif(testConfig.enabled)(
    'US1: LLM reads a file and answers questions about it',
    async () => {
      // Setup: create a config file with known content
      const configContent = JSON.stringify(
        {
          name: 'wrangler',
          version: '1.2.3',
          description: 'Agent crew orchestrator',
        },
        null,
        2
      );
      await writeFile(join(workspace, 'config.json'), configContent);

      // Create runner with file tools
      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      // Ask LLM to read the file and tell us the version
      let state = createAgentState({
        name: 'file-reader',
        instructions:
          'You are a helpful assistant. Use the file_read tool to read files, then answer questions about their contents. Be concise.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Read the file config.json and tell me what the version number is. Just say the version number.'
      );

      const { state: finalState, result } = await runner.run(state);

      expect(result.type).toBe('success');

      // Extract assistant response
      const messages = finalState.context.messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      expect(lastAssistant).toBeDefined();

      const responseText =
        typeof lastAssistant!.content === 'string'
          ? lastAssistant!.content
          : JSON.stringify(lastAssistant!.content);

      // Verify LLM correctly read and extracted the version
      expect(responseText.toLowerCase()).toContain('1.2.3');

      // Verify that file_read tool was actually called
      const toolCalls = messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.toolCalls || []);
      const readFileCalls = toolCalls.filter((tc) => tc.name === 'file_read');
      expect(readFileCalls.length).toBeGreaterThan(0);
    },
    60000
  );

  /**
   * US2: LLM writes a file, then reads it back
   *
   * Given an empty workspace
   * When I ask the LLM to create a file with specific content
   * And then ask it to read it back and confirm
   * Then the file should exist on disk with correct content
   * And the LLM should correctly report what it wrote
   */
  itif(testConfig.enabled)(
    'US2: LLM writes a file, then reads it back',
    async () => {
      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      // Step 1: Ask LLM to create a file
      let state = createAgentState({
        name: 'file-writer',
        instructions:
          'You are a helpful assistant. Use the file_write tool to create files with the exact content requested. Be concise.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Create a file called greeting.txt with the content "Hello, World!" (without quotes)'
      );

      const { state: finalState1, result: result1 } = await runner.run(state);
      expect(result1.type).toBe('success');

      // Verify file exists on disk with correct content
      const actualContent = await readFile(join(workspace, 'greeting.txt'), 'utf8');
      expect(actualContent.trim()).toBe('Hello, World!');

      // Step 2: Ask LLM to read it back
      const state2 = createAgentState({
        name: 'file-reader',
        instructions:
          'You are a helpful assistant. Use the file_read tool to read files, then tell me what they contain.',
        tools: [],
      });
      const state2WithMsg = addUserMessage(
        state2,
        'Read the file greeting.txt and tell me what it says'
      );

      const { state: finalState2, result: result2 } = await runner.run(state2WithMsg);
      expect(result2.type).toBe('success');

      // Verify LLM response contains the correct content
      const messages = finalState2.context.messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      expect(lastAssistant).toBeDefined();

      const responseText =
        typeof lastAssistant!.content === 'string'
          ? lastAssistant!.content
          : JSON.stringify(lastAssistant!.content);

      expect(responseText.toLowerCase()).toContain('hello, world!');

      // Verify both tools were used
      const allMessages = [...finalState1.context.messages, ...finalState2.context.messages];
      const toolCalls = allMessages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.toolCalls || []);
      const writeFileCalls = toolCalls.filter((tc) => tc.name === 'file_write');
      const readFileCalls = toolCalls.filter((tc) => tc.name === 'file_read');
      expect(writeFileCalls.length).toBeGreaterThan(0);
      expect(readFileCalls.length).toBeGreaterThan(0);
    },
    60000
  );

  /**
   * US3: LLM edits a file
   *
   * Given a file with initial content
   * When I ask the LLM to read it and make a specific change
   * Then the file on disk should be updated
   * And the LLM should confirm the change
   */
  itif(testConfig.enabled)(
    'US3: LLM edits a file',
    async () => {
      // Setup: create initial file
      const initialContent = JSON.stringify(
        {
          name: 'wrangler',
          version: '0.1.0',
          description: 'Test project',
        },
        null,
        2
      );
      await writeFile(join(workspace, 'config.json'), initialContent);

      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      // Ask LLM to read the file and change the version
      let state = createAgentState({
        name: 'file-editor',
        instructions:
          'You are a helpful assistant. Use file_read to read files, then use file_edit to make changes. Be concise.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Read the file config.json, then change the version from "0.1.0" to "0.2.0" using the file_edit tool.'
      );

      const { state: finalState, result } = await runner.run(state);
      expect(result.type).toBe('success');

      // Verify file on disk has been updated
      const updatedContent = await readFile(join(workspace, 'config.json'), 'utf8');
      const config = JSON.parse(updatedContent);
      expect(config.version).toBe('0.2.0');

      // Verify tools were used
      const messages = finalState.context.messages;
      const toolCalls = messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.toolCalls || []);
      const readFileCalls = toolCalls.filter((tc) => tc.name === 'file_read');
      const editFileCalls = toolCalls.filter((tc) => tc.name === 'file_edit');
      expect(readFileCalls.length).toBeGreaterThan(0);
      expect(editFileCalls.length).toBeGreaterThan(0);
    },
    60000
  );

  /**
   * US4: LLM uses glob to find files
   *
   * Given a workspace with multiple files of different types
   * When I ask the LLM to find files matching a pattern
   * Then the LLM should use glob tool and report correct results
   */
  itif(testConfig.enabled)(
    'US4: LLM uses glob to find files',
    async () => {
      // Setup: create mix of .ts and .js files
      await writeFile(join(workspace, 'index.ts'), 'export {}');
      await writeFile(join(workspace, 'utils.ts'), 'export {}');
      await writeFile(join(workspace, 'config.js'), 'module.exports = {}');
      await writeFile(join(workspace, 'app.js'), 'module.exports = {}');

      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      // Ask LLM to find TypeScript files
      let state = createAgentState({
        name: 'file-finder',
        instructions:
          'You are a helpful assistant. Use the glob tool to find files. List the matching files you find.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Find all TypeScript files (*.ts) in the workspace using the glob tool. List them.'
      );

      const { state: finalState, result } = await runner.run(state);
      expect(result.type).toBe('success');

      // Verify LLM response mentions .ts files
      const messages = finalState.context.messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      expect(lastAssistant).toBeDefined();

      const responseText =
        typeof lastAssistant!.content === 'string'
          ? lastAssistant!.content
          : JSON.stringify(lastAssistant!.content);

      // Should mention TypeScript files
      expect(responseText.toLowerCase()).toContain('.ts');
      // Should NOT mention .js files (or at least distinguish them)
      const hasJsMention = responseText.toLowerCase().includes('.js');
      if (hasJsMention) {
        // If .js is mentioned, it should be clear it's not a match
        expect(responseText.toLowerCase()).toMatch(/not|exclude|only|typescript/i);
      }

      // Verify glob tool was used
      const toolCalls = messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.toolCalls || []);
      const globCalls = toolCalls.filter((tc) => tc.name === 'glob');
      expect(globCalls.length).toBeGreaterThan(0);
    },
    60000
  );

  /**
   * US5: LLM uses grep to search file contents
   *
   * Given a workspace with files containing specific content
   * When I ask the LLM to search for a pattern
   * Then the LLM should use grep tool and report correct results
   */
  itif(testConfig.enabled)(
    'US5: LLM uses grep to search file contents',
    async () => {
      // Setup: create files with specific content
      await writeFile(
        join(workspace, 'user.ts'),
        'export function getUser(id: string) {\n  return db.findOne(id);\n}'
      );
      await writeFile(
        join(workspace, 'product.ts'),
        'export function getProduct(id: string) {\n  return db.findProduct(id);\n}'
      );
      await writeFile(
        join(workspace, 'README.md'),
        '# User API\n\nUse getUser to fetch user data.'
      );

      const tools = createBuiltinTools({ workspacePath: workspace });
      const runner = makeRunner(tools);

      // Ask LLM to search for 'getUser'
      let state = createAgentState({
        name: 'content-searcher',
        instructions:
          'You are a helpful assistant. Use the grep tool to search for text in files. Report what you find.',
        tools: [],
      });
      state = addUserMessage(
        state,
        'Search for "getUser" in the workspace using the grep tool. Tell me which files contain it.'
      );

      const { state: finalState, result } = await runner.run(state);
      expect(result.type).toBe('success');

      // Verify LLM response mentions the correct file
      const messages = finalState.context.messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      expect(lastAssistant).toBeDefined();

      const responseText =
        typeof lastAssistant!.content === 'string'
          ? lastAssistant!.content
          : JSON.stringify(lastAssistant!.content);

      // Should mention user.ts
      expect(responseText.toLowerCase()).toContain('user.ts');

      // Verify grep tool was used
      const toolCalls = messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.toolCalls || []);
      const grepCalls = toolCalls.filter((tc) => tc.name === 'grep');
      expect(grepCalls.length).toBeGreaterThan(0);
    },
    60000
  );
});
