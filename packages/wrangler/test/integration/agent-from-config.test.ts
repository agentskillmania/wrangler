/**
 * US1: 从 AGENT.md 创建 agent
 *
 * 作为开发者，我通过 parseAgentMd 解析 AGENT.md 文件，
 * 获取 agent 定义，然后用 ConfigurableAgent 自动组装 AgentRunner 运行。
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseAgentMd } from '../../src/agent/agent-loader.js';
import { ConfigurableAgent } from '../../src/agent/configurable-agent.js';
import { SessionStore } from '../../src/session/session-store.js';
import { testConfig, itif } from './config.js';

describe('US1: 从 AGENT.md 创建 agent', () => {
  let testBaseDir: string;

  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(`[Layer5 US1] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`);
    }
  });

  beforeEach(async () => {
    testBaseDir = join(tmpdir(), `wrangler-intg-l5us1-${Date.now()}`);
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testBaseDir, { recursive: true, force: true });
  });

  describe('parseAgentMd', () => {
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

      expect(def.meta.name).toBe('code-reviewer');
      expect(def.meta.description).toBe('Reviews code for quality');
      expect(def.meta.thinking?.enabled).toBe(true);
      expect(def.instructions).toContain('senior code reviewer');
    });

    it('parses AGENT.md with only instructions', () => {
      const content = 'You are a helpful assistant that answers questions concisely.';
      const def = parseAgentMd(content, 'simple-agent');

      expect(def.meta.name).toBe('simple-agent');
      expect(def.instructions).toContain('helpful assistant');
    });
  });

  itif(testConfig.enabled)(
    'ConfigurableAgent runs with parsed AGENT.md definition',
    async () => {
      const agentMd = `---
name: test-helper
description: A simple helper
---

You are a helpful assistant. Answer in one short sentence.`;

      const agentDef = parseAgentMd(agentMd);
      expect(agentDef.meta.name).toBe('test-helper');

      const agent = new ConfigurableAgent(agentDef, testBaseDir, {
        llmClient: {
          apiKey: testConfig.apiKey,
          provider: testConfig.provider,
          baseUrl: testConfig.baseUrl,
        } as any,
        defaultModel: testConfig.testModel,
        sessionBaseDir: testBaseDir,
      });

      const result = await agent.run('What is 2 + 2?');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');

      // Verify session was persisted
      const store = new SessionStore(testBaseDir, testBaseDir);
      const sessions = await store.listSessions();
      expect(sessions.length).toBeGreaterThan(0);
    },
    60000
  );
});
