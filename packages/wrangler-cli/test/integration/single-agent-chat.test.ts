/**
 * US2: Single agent chat with real LLM
 *
 * As a developer, I load an agent from an AGENT.md directory, create an
 * EnhancedRunner with a real LLMClient, run a streaming conversation,
 * and verify that timeline entries are produced correctly.
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

/**
 * Adapter: converts colts RunStreamEvent types to TUI-level event types
 * that StreamConsumer understands.
 *
 * Mapping:
 *   token         -> text-delta (text = token)
 *   tool:start    -> tool-start (toolName = action.tool)
 *   tool:end      -> tool-end   (toolName from event, result from event)
 *   complete      -> run-complete
 *   error         -> error (passthrough)
 *   step:start    -> user-message (content from last user message in state)
 *   llm:response  -> (ignored, handled via token stream)
 */
function adaptStreamEvent(event: Record<string, unknown>): Record<string, unknown>[] {
  const type = event.type as string;

  switch (type) {
    case 'token': {
      return [{ type: 'text-delta', text: event.token, timestamp: event.timestamp }];
    }
    case 'tool:start': {
      const action = event.action as Record<string, unknown> | undefined;
      return [
        {
          type: 'tool-start',
          toolName: action?.tool ?? 'unknown',
          toolCallId: action?.id ?? '',
          timestamp: event.timestamp,
        },
      ];
    }
    case 'tool:end': {
      return [
        {
          type: 'tool-end',
          toolName: '',
          toolCallId: event.callId ?? '',
          result: event.result,
          timestamp: event.timestamp,
        },
      ];
    }
    case 'complete': {
      return [{ type: 'run-complete', result: event.result, timestamp: event.timestamp }];
    }
    case 'error': {
      return [event];
    }
    default: {
      // Ignore other events (phase-change, step:start, step:end, etc.)
      return [];
    }
  }
}

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
        skillDirectories: loaded.skillDirs,
      });

      // Step 4: createAgentState()
      let state = createAgentState({
        name: loaded.name,
        instructions: loaded.instructions,
        tools: [],
      });

      // Step 5: addUserMessage
      state = addUserMessage(state, 'What is 2 + 2?');

      // Step 6: Run stream and feed events through StreamConsumer
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

      const stream = runner.runStream(state, { maxSteps: 5 });
      for await (const rawEvent of stream) {
        const adapted = adaptStreamEvent(rawEvent as Record<string, unknown>);
        for (const event of adapted) {
          const newEntries = consumer.consume(event);
          if (newEntries.length > 0) {
            allEntries.push(...newEntries);
          }
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
        skillDirectories: loaded.skillDirs,
      });

      let state = createAgentState({
        name: loaded.name,
        instructions: loaded.instructions,
        tools: [],
      });
      state = addUserMessage(state, 'Please read the file hello.txt and tell me its contents.');

      const consumer = new StreamConsumer();
      const allEntries: ReturnType<StreamConsumer['consume']>[number][] = [];

      const stream = runner.runStream(state, { maxSteps: 10 });
      for await (const rawEvent of stream) {
        const adapted = adaptStreamEvent(rawEvent as Record<string, unknown>);
        for (const event of adapted) {
          const newEntries = consumer.consume(event);
          if (newEntries.length > 0) {
            allEntries.push(...newEntries);
          }
        }
      }

      const flushed = consumer.flush();
      if (flushed.length > 0) {
        allEntries.push(...flushed);
      }

      // Verify that we got tool entries (file_read or similar)
      const toolEntries = allEntries.filter((e) => e.type === 'tool');
      const assistantEntries = allEntries.filter(
        (e) => e.type === 'assistant' && !('isStreaming' in e && e.isStreaming)
      );
      const errorEntries = allEntries.filter((e) => e.type === 'error');

      expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
      expect(errorEntries.length).toBe(0);

      // The agent should have used at least one tool
      expect(toolEntries.length).toBeGreaterThanOrEqual(1);
    },
    90000
  );
});
