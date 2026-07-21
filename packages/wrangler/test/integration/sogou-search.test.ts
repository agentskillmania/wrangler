/**
 * Integration Tests for SogouScrapeSearchProvider
 *
 * Tests real Sogou search scraping with actual network requests.
 * These tests do NOT require LLM API keys — they only test the search provider
 * against live Sogou HTML.
 *
 * Prerequisites:
 * - Network access to https://www.sogou.com
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SogouScrapeSearchProvider } from '../../src/tools/builtin/sogou-scrape-search.js';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createWebSearchTool } from '../../src/tools/builtin/web-search.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { testConfig } from './config.js';

const ENABLE_NETWORK_TESTS = process.env.ENABLE_INTEGRATION_TESTS === 'true';

const itif = (condition: boolean) => (condition ? it : it.skip);

describe('SogouScrapeSearchProvider (live)', () => {
  const provider = new SogouScrapeSearchProvider();

  itif(ENABLE_NETWORK_TESTS)(
    'returns results for a common English query',
    async () => {
      const results = await provider.search('TypeScript tutorial');
      expect(results.length).toBeGreaterThanOrEqual(3);

      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.url).toMatch(/^https?:\/\//);
        expect(r.snippet).toBeTruthy();
      }

      const hasTypeScript = results.some(
        (r) =>
          r.title.toLowerCase().includes('typescript') ||
          r.snippet.toLowerCase().includes('typescript')
      );
      expect(hasTypeScript).toBe(true);
    },
    30000
  );

  itif(ENABLE_NETWORK_TESTS)(
    'returns results for a Chinese query',
    async () => {
      const results = await provider.search('Python 入门教程');
      expect(results.length).toBeGreaterThanOrEqual(3);

      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.url).toMatch(/^https?:\/\//);
      }
    },
    30000
  );

  itif(ENABLE_NETWORK_TESTS)(
    'returns results for a technical query with special characters',
    async () => {
      const results = await provider.search('node.js stream.pipe() usage');
      expect(results.length).toBeGreaterThanOrEqual(3);

      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.url).toMatch(/^https?:\/\//);
      }
    },
    30000
  );

  itif(ENABLE_NETWORK_TESTS)(
    'consecutive searches return consistent structure',
    async () => {
      const results1 = await provider.search('React hooks');
      const results2 = await provider.search('Vue composition API');

      expect(results1.length).toBeGreaterThanOrEqual(3);
      expect(results2.length).toBeGreaterThanOrEqual(3);

      for (const results of [results1, results2]) {
        for (const r of results) {
          expect(r).toHaveProperty('title');
          expect(r).toHaveProperty('url');
          expect(r).toHaveProperty('snippet');
        }
      }

      const titles1 = new Set(results1.map((r) => r.title));
      const titles2 = new Set(results2.map((r) => r.title));
      const overlap = [...titles1].filter((t) => titles2.has(t));
      expect(overlap.length).toBeLessThan(results1.length);
    },
    30000
  );
});

/**
 * E2E Integration Test: LLM uses web_search tool with SogouScrapeSearchProvider
 */

describe('web_search with SogouScrapeSearchProvider (LLM E2E)', () => {
  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Web Search E2E] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  function createSearchRunner() {
    const searchProvider = new SogouScrapeSearchProvider();
    const tools = [createWebSearchTool(searchProvider)];

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
      middleware: [],
      messageAssembler: new MarkdownMessageAssembler(),
    });
  }

  itif(testConfig.enabled)(
    'LLM searches for information and answers based on results',
    async () => {
      const runner = createSearchRunner();

      let state = createAgentState({
        name: 'search-agent',
        instructions:
          'You are a helpful assistant. Use the web_search tool to find information on the internet. Answer questions based on search results. Be concise.',
        tools: [],
      });

      state = addUserMessage(
        state,
        'Use the web_search tool to search for "Rust programming language" and tell me what Rust is known for based on the search results.'
      );

      const { result, state: finalState } = await runner.run(state);

      expect(result.type).toBe('success');

      const assistantMessages = finalState.context.messages.filter((m) => m.role === 'assistant');
      expect(assistantMessages.length).toBeGreaterThan(0);

      const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
      const responseText =
        typeof lastAssistantMessage.content === 'string'
          ? lastAssistantMessage.content
          : JSON.stringify(lastAssistantMessage.content);

      const lower = responseText.toLowerCase();
      const hasRustMention =
        lower.includes('memory') ||
        lower.includes('safety') ||
        lower.includes('performance') ||
        lower.includes('concurrent') ||
        lower.includes('systems') ||
        lower.includes('language');

      expect(
        hasRustMention,
        `Expected response to mention Rust characteristics, but got: ${responseText.slice(0, 300)}`
      ).toBe(true);
    },
    180000
  );
});
