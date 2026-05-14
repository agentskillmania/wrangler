/**
 * US3: StreamConsumer produces correct timeline from real stream
 *
 * As a developer, I run a real agent stream and feed all events through
 * the StreamConsumer, verifying that the final timeline has correct entry
 * types, ordering, and content.
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
import { EnhancedRunner } from '@agentskillmania/wrangler';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { StreamConsumer } from '../../src/hooks/use-stream-consumer.js';
import type { TimelineEntry } from '../../src/types.js';
import { testConfig, itif } from './config.js';

/**
 * Adapter: converts colts RunStreamEvent types to TUI-level event types
 * that StreamConsumer understands.
 *
 * Mapping:
 *   token         -> text-delta (text = token)
 *   tool:start    -> tool-start (toolName = action.tool)
 *   tool:end      -> tool-end   (result from event)
 *   complete      -> run-complete
 *   error         -> error (passthrough)
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
      return [];
    }
  }
}

describe('US3: StreamConsumer produces correct timeline from real stream', () => {
  let testBaseDir: string;

  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(`[US3] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`);
    }
  });

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-cli-intg-stream-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  itif(testConfig.enabled)(
    'consumer produces assistant entries from token stream events',
    async () => {
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
      });

      let state = createAgentState({
        name: 'stream-test',
        instructions: 'You are a helpful assistant. Be brief.',
        tools: [],
      });
      state = addUserMessage(state, 'Say hello.');

      const consumer = new StreamConsumer();
      const allEntries: TimelineEntry[] = [];

      const stream = runner.runStream(state, { maxSteps: 3 });
      for await (const rawEvent of stream) {
        const adapted = adaptStreamEvent(rawEvent as Record<string, unknown>);
        for (const event of adapted) {
          const newEntries = consumer.consume(event);
          allEntries.push(...newEntries);
        }
      }

      // Flush remaining buffered content
      const flushed = consumer.flush();
      allEntries.push(...flushed);

      // Verify we have entries
      expect(allEntries.length).toBeGreaterThan(0);

      // Verify at least one assistant entry
      const assistantEntries = allEntries.filter((e) => e.type === 'assistant');
      expect(assistantEntries.length).toBeGreaterThanOrEqual(1);

      // Verify streaming assistant entries were produced (isStreaming=true)
      const streamingEntries = assistantEntries.filter(
        (e) => 'isStreaming' in e && e.isStreaming === true
      );
      expect(streamingEntries.length).toBeGreaterThanOrEqual(1);

      // Verify final flushed entry has isStreaming=false or undefined
      const finalAssistant = assistantEntries.find((e) => !('isStreaming' in e && e.isStreaming));
      expect(finalAssistant).toBeDefined();
      expect(finalAssistant!.content).toBeTruthy();

      // Verify seq numbers are non-decreasing (streaming entries may share seq)
      const seqs = allEntries.map((e) => e.seq);
      const uniqueSeqs = [...new Set(seqs)];
      for (let i = 1; i < uniqueSeqs.length; i++) {
        expect(uniqueSeqs[i]).toBeGreaterThan(uniqueSeqs[i - 1]);
      }
    },
    60000
  );

  itif(testConfig.enabled)(
    'consumer handles tool events correctly',
    async () => {
      // Create a file for the agent to read
      await writeFile(join(testBaseDir, 'test.txt'), 'Test content');

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
      });

      let state = createAgentState({
        name: 'tool-test',
        instructions:
          'You are a helpful assistant. When asked about files, use the file_read tool to read them. Be brief.',
        tools: [],
      });
      state = addUserMessage(state, 'Read the file test.txt');

      const consumer = new StreamConsumer();
      const allEntries: TimelineEntry[] = [];

      const stream = runner.runStream(state, { maxSteps: 10 });
      for await (const rawEvent of stream) {
        const adapted = adaptStreamEvent(rawEvent as Record<string, unknown>);
        for (const event of adapted) {
          const newEntries = consumer.consume(event);
          allEntries.push(...newEntries);
        }
      }

      const flushed = consumer.flush();
      allEntries.push(...flushed);

      // Verify tool entries are present
      const toolEntries = allEntries.filter((e) => e.type === 'tool');
      expect(toolEntries.length).toBeGreaterThanOrEqual(1);

      // Verify tool-start entries have isRunning=true
      const runningTools = toolEntries.filter((e) => 'isRunning' in e && e.isRunning === true);
      expect(runningTools.length).toBeGreaterThanOrEqual(1);

      // Verify tool-end entries have isRunning=false
      const completedTools = toolEntries.filter((e) => 'isRunning' in e && e.isRunning === false);
      expect(completedTools.length).toBeGreaterThanOrEqual(1);

      // Verify we also have assistant entries (the final answer)
      const assistantEntries = allEntries.filter((e) => e.type === 'assistant');
      expect(assistantEntries.length).toBeGreaterThanOrEqual(1);
    },
    90000
  );
});
