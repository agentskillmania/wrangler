/**
 * US1: Load agent from AGENT.md and run with EnhancedRunner
 *
 * As a developer, I use AgentLoader.loadFrom() to parse an AGENT.md directory,
 * then create an EnhancedRunner to run the agent with all wrangler mechanisms.
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
import { parseAgentMd } from '../../src/agent/agent-parser.js';
import { AgentLoader } from '../../src/loader/agent-loader.js';
import { EnhancedRunner } from '../../src/runner/enhanced-runner.js';
import { createAgentState, addUserMessage } from '@agentskillmania/colts';
import { testConfig, itif } from './config.js';

describe('US1: Load agent from AGENT.md and run with EnhancedRunner', () => {
  let testBaseDir: string;

  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(`[Layer4 US1] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`);
    }
  });

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-l4us1-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  describe('parseAgentMd (flat ParsedAgent)', () => {
    it('parses AGENT.md with frontmatter and instructions', () => {
      const content = `---
name: code-reviewer
description: Reviews code for quality
thinking:
  enabled: true
---

You are a senior code reviewer. Focus on:
- Security vulnerabilities
- Performance issues
- Code readability
`;

      const def = parseAgentMd(content);

      expect(def.name).toBe('code-reviewer');
      expect(def.description).toBe('Reviews code for quality');
      expect(def.thinking?.enabled).toBe(true);
      expect(def.instructions).toContain('senior code reviewer');
    });

    it('parses AGENT.md with only instructions (no frontmatter)', () => {
      const content = 'You are a helpful assistant that answers questions concisely.';
      const def = parseAgentMd(content, 'simple-agent');

      expect(def.name).toBe('simple-agent');
      expect(def.instructions).toContain('helpful assistant');
    });

    it('parses AGENT.md with model field', () => {
      const content = `---
name: tester
model: gpt-4o
---

You test things.`;

      const def = parseAgentMd(content);
      expect(def.name).toBe('tester');
      expect(def.model).toBe('gpt-4o');
      expect(def.instructions).toContain('You test things.');
    });
  });

  describe('AgentLoader.loadFrom', () => {
    it('loads agent from directory with AGENT.md', async () => {
      const agentDir = join(testBaseDir, 'my-agent');
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, 'AGENT.md'),
        `---
name: code-reviewer
description: Reviews code
model: gpt-4o
---

You are a code reviewer.`
      );

      const result = await AgentLoader.loadFrom(agentDir);
      expect(result.name).toBe('code-reviewer');
      expect(result.description).toBe('Reviews code');
      expect(result.model).toBe('gpt-4o');
      expect(result.instructions).toContain('You are a code reviewer.');
      expect(result.skillDirectories).toEqual([]);
      expect(result.mcpPaths).toEqual([]);
    });

    it('loads agent with skills and mcp.json', async () => {
      const agentDir = join(testBaseDir, 'agent-with-extras');
      await mkdir(agentDir, { recursive: true });
      await mkdir(join(agentDir, 'skills', 'search'), { recursive: true });
      await writeFile(join(agentDir, 'AGENT.md'), `---\nname: search-agent\n---\nSearch things.`);
      await writeFile(join(agentDir, 'mcp.json'), '{}');

      const result = await AgentLoader.loadFrom(agentDir);
      expect(result.name).toBe('search-agent');
      expect(result.skillDirectories).toHaveLength(1);
      expect(result.mcpPaths).toHaveLength(1);
    });

    it('throws when AGENT.md not found', async () => {
      const emptyDir = join(testBaseDir, 'empty');
      await mkdir(emptyDir, { recursive: true });

      await expect(AgentLoader.loadFrom(emptyDir)).rejects.toThrow('AGENT.md not found');
    });
  });

  itif(testConfig.enabled)(
    'EnhancedRunner runs with AgentLoader result',
    async () => {
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

      const loaded = await AgentLoader.loadFrom(agentDir);
      expect(loaded.name).toBe('test-helper');

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
        skillDirectories: loaded.skillDirectories,
      });

      let state = createAgentState({
        name: loaded.name,
        instructions: loaded.instructions,
        tools: [],
      });
      state = addUserMessage(state, 'What is 2 + 2?');

      const result = await runner.run(state, { maxSteps: 5 });
      expect(result).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.result.type).toBe('success');
      expect(result.result.answer).toBeTruthy();
    },
    60000
  );
});
