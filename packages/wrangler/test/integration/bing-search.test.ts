/**
 * Integration Tests for BingScrapeSearchProvider
 *
 * Tests real Bing search scraping with actual network requests.
 * These tests do NOT require LLM API keys — they only test the search provider
 * against live Bing HTML.
 *
 * Prerequisites:
 * - Network access to https://www.bing.com
 */

import { describe, it, expect } from 'vitest';
import { BingScrapeSearchProvider } from '../../src/tools/builtin/bing-scrape-search.js';

const ENABLE_NETWORK_TESTS = process.env.ENABLE_INTEGRATION_TESTS === 'true';

const itif = (condition: boolean) => (condition ? it : it.skip);

describe('BingScrapeSearchProvider (live)', () => {
  const provider = new BingScrapeSearchProvider();

  itif(ENABLE_NETWORK_TESTS)(
    'returns results for a common English query',
    async () => {
      const results = await provider.search('TypeScript tutorial');
      expect(results.length).toBeGreaterThanOrEqual(5);
      expect(results.length).toBeLessThanOrEqual(10);

      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.url).toMatch(/^https?:\/\//);
        expect(r.snippet).toBeTruthy();
      }

      // At least one result should mention TypeScript
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
    'returns empty for an extremely obscure query',
    async () => {
      // Use a random UUID as query — very unlikely to have results
      const results = await provider.search(
        'zzzzzzzzzzxxxxxxxxqqqqqqqqqq1234567890abcdefnonexistent'
      );
      // Bing typically returns at least some results for anything,
      // but this verifies the provider doesn't crash on unusual responses
      expect(Array.isArray(results)).toBe(true);
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

      // Each result has the expected shape
      for (const results of [results1, results2]) {
        for (const r of results) {
          expect(r).toHaveProperty('title');
          expect(r).toHaveProperty('url');
          expect(r).toHaveProperty('snippet');
        }
      }

      // Results should be different for different queries
      const titles1 = new Set(results1.map((r) => r.title));
      const titles2 = new Set(results2.map((r) => r.title));
      const overlap = [...titles1].filter((t) => titles2.has(t));
      // Allow some overlap but not all identical
      expect(overlap.length).toBeLessThan(results1.length);
    },
    30000
  );
});

/**
 * E2E Integration Test: LLM uses web_search tool with BingScrapeSearchProvider
 *
 * Tests that the full pipeline works: AgentRunner → web_search → BingScrapeSearchProvider → Bing.
 *
 * Prerequisites:
 * - Set ENABLE_INTEGRATION_TESTS=true in .env
 * - Set OPENAI_API_KEY in .env
 */

import { beforeAll } from 'vitest';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { createWebSearchTool } from '../../src/tools/builtin/web-search.js';
import { BingScrapeSearchProvider } from '../../src/tools/builtin/bing-scrape-search.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { testConfig } from './config.js';

describe('web_search with BingScrapeSearchProvider (LLM E2E)', () => {
  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Web Search E2E] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  function createSearchRunner() {
    const searchProvider = new BingScrapeSearchProvider();
    const tools = [createWebSearchTool(searchProvider)];

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
      // Should mention Rust-related concepts
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
    60000
  );
});
