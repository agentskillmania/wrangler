/**
 * US2: Single agent chat with real LLM
 *
 * As a developer, I load an agent from an AGENT.md directory, create an
 * EnhancedRunner with a real LLMClient, run a streaming conversation,
 * and verify that timeline entries are produced correctly.
 *
 * StreamConsumer handles colts RunStreamEvent types natively — no adapter needed.
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LLMClient } from '@agentskillmania/llm-client';
import { AgentLoader, EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { StreamConsumer } from '../../src/hooks/use-stream-consumer.js';
import { testConfig, itif } from './config.js';

describe('US2: Single agent chat with real LLM', () => {
  let testBaseDir: string;

  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(`[US2] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`);
    }
  });

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-cli-intg-chat-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  itif(testConfig.enabled)(
    'loads agent from AGENT.md and runs streaming conversation',
    async () => {
      // Step 1: Create temp dir with AGENT.md
      const agentDir = join(testBaseDir, 'test-agent');
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, 'AGENT.md'),
        `---
name: test-helper
description: A simple helper
---

You are a helpful assistant. Answer in one short sentence.`
      );

      // Step 2: AgentLoader.loadFrom()
      const loaded = await AgentLoader.loadFrom(agentDir);
      expect(loaded.name).toBe('test-helper');
      expect(loaded.instructions).toContain('helpful assistant');

      // Step 3: EnhancedRunner.create() with real LLMClient
      const llmClient = new LLMClient({ baseUrl: testConfig.baseUrl });
      llmClient.registerProvider({ name: testConfig.provider, maxConcurrency: 5 });
      llmClient.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 5,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 5 }],
      });

      const runner = await EnhancedRunner.create({
        llmClient,
        model: testConfig.testModel,
        workspacePath: testBaseDir,
        mcpConfigPaths: [],
        skillDirs: loaded.skillDirs,
      });

      // Step 4: createAgentState()
      let state = createAgentState({
        name: loaded.name,
        instructions: loaded.instructions,
        tools: [],
      });

      // Step 5: addUserMessage
      state = addUserMessage(state, 'What is 2 + 2?');

      // Step 6: Run stream and feed raw colts events to StreamConsumer
      const consumer = new StreamConsumer();
      const allEntries: ReturnType<StreamConsumer['consume']>[number][] = [];

      // Add user entry manually (as useAgent hook does)
      const userEntry = {
        type: 'user' as const,
        id: `user-${Date.now()}`,
        seq: 1,
        content: 'What is 2 + 2?',
        timestamp: Date.now(),
      };
      allEntries.push(userEntry);

      // Feed raw colts events directly — StreamConsumer handles them natively
      const stream = runner.runStream(state, { maxSteps: 5 });
      for await (const event of stream) {
        const newEntries = consumer.consume(event as Record<string, unknown>);
        if (newEntries.length > 0) {
          allEntries.push(...newEntries);
        }
      }

      // Flush remaining buffered content
      const flushed = consumer.flush();
      if (flushed.length > 0) {
        allEntries.push(...flushed);
      }

      // Step 7: Verify timeline has user + assistant entries
      const userEntries = allEntries.filter((e) => e.type === 'user');
      const assistantEntries = allEntries.filter((e) => e.type === 'assistant');
      const errorEntries = allEntries.filter((e) => e.type === 'error');

      expect(userEntries.length).toBeGreaterThanOrEqual(1);
      expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
      expect(errorEntries.length).toBe(0);

      // Verify assistant content is non-empty
      const finalAssistant = assistantEntries.filter((e) => !('isStreaming' in e && e.isStreaming));
      const assistantContent = finalAssistant.map((e) => e.content).join(' ');
      expect(assistantContent).toBeTruthy();
    },
    60000
  );

  itif(testConfig.enabled)(
    'agent can use tools in streaming mode',
    async () => {
      // Create a workspace with a file for the agent to read
      await writeFile(join(testBaseDir, 'hello.txt'), 'Hello from the file!');

      const agentDir = join(testBaseDir, 'file-reader');
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, 'AGENT.md'),
        `---
name: file-reader
description: Reads files
---

You are a file reading assistant. When asked about file contents, use the file_read tool. Be brief.`
      );

      const loaded = await AgentLoader.loadFrom(agentDir);

      const llmClient = new LLMClient({ baseUrl: testConfig.baseUrl });
      llmClient.registerProvider({ name: testConfig.provider, maxConcurrency: 5 });
      llmClient.registerApiKey({
        key: testConfig.apiKey,
        provider: testConfig.provider,
        maxConcurrency: 5,
        models: [{ modelId: testConfig.testModel, maxConcurrency: 5 }],
      });

      const runner = await EnhancedRunner.create({
        llmClient,
        model: testConfig.testModel,
        workspacePath: testBaseDir,
        mcpConfigPaths: [],
        skillDirs: loaded.skillDirs,
      });

      let state = createAgentState({
        name: loaded.name,
        instructions: loaded.instructions,
        tools: [],
      });
      state = addUserMessage(state, 'Please read the file hello.txt and tell me its contents.');

      const consumer = new StreamConsumer();
      const allEntries: ReturnType<StreamConsumer['consume']>[number][] = [];

      // Feed raw colts events directly
      const stream = runner.runStream(state, { maxSteps: 10 });
      for await (const event of stream) {
        const newEntries = consumer.consume(event as Record<string, unknown>);
        if (newEntries.length > 0) {
          allEntries.push(...newEntries);
        }
      }

      const flushed = consumer.flush();
      if (flushed.length > 0) {
        allEntries.push(...flushed);
      }

      // Verify assistant entries
      const assistantEntries = allEntries.filter(
        (e) => e.type === 'assistant' && !('isStreaming' in e && e.isStreaming)
      );
      const errorEntries = allEntries.filter((e) => e.type === 'error');

      expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
      expect(errorEntries.length).toBe(0);

      // Tool entries may or may not be present — model decides whether to use tools
      const toolEntries = allEntries.filter((e) => e.type === 'tool');
      if (toolEntries.length > 0) {
        const runningTools = toolEntries.filter((e) => 'isRunning' in e && e.isRunning === true);
        const completedTools = toolEntries.filter((e) => 'isRunning' in e && e.isRunning === false);
        expect(runningTools.length).toBeGreaterThanOrEqual(1);
        expect(completedTools.length).toBeGreaterThanOrEqual(1);
      }
    },
    90000
  );
});
