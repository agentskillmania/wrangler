/**
 * Integration Tests: web_search sogou provider 链回退（R2P-243）
 *
 * sogou antispider 是 IP 计分的动态风控——本机/CI 随时可能被拦（302→
 * antispider 挑战或裸 403），但选择器与解析逻辑本身正常。因此本文件采用
 * 双模式断言（零 skip，两分支都跑真断言）：
 *
 *   beforeAll canary 探针（一次轻量请求判风控状态）：
 *   - 未被拦 → 走 sogou 原链：结果 provider 标记 'sogou'，原 live 断言
 *     （≥3 结果 / 形状 / 相关性）+ 直连 provider 的解析断言。
 *   - 被拦   → 断言回退路径真结果：provider 标记严格为 'bing'（非 sogou）
 *     且 ≥3 真结果——被拦不再是环境红。
 *   - 探针网络失败 → 测试显式 fail 并注明环境原因（网络全断属环境红）。
 *
 * 注意：未拦模式下单条查询期间风控突袭（IP 计分随请求加速）属正常现象，
 * 链会正确回退 bing——故未拦分支的 provider 标记接受 'sogou' | 'bing'。
 *
 * Prerequisites:
 * - Network access to https://www.sogou.com 与 https://www.bing.com
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LLMClient } from '@agentskillmania/llm-client';
import { AgentRunner, createAgentState, addUserMessage } from '@agentskillmania/colts';
import { SogouScrapeSearchProvider } from '../../src/tools/builtin/sogou-scrape-search.js';
import { BingScrapeSearchProvider } from '../../src/tools/builtin/bing-scrape-search.js';
import { createWebSearchTool, FallbackSearchProvider } from '../../src/tools/builtin/web-search.js';
import { MarkdownMessageAssembler } from '../../src/runner/markdown-assembler.js';
import { testConfig } from './config.js';

const ENABLE_NETWORK_TESTS = process.env.ENABLE_INTEGRATION_TESTS === 'true';

const itif = (condition: boolean) => (condition ? it : it.skip);

/** 与生产组装（resolveSearchProvider 默认）一致的 sogou→bing 回退链。 */
function createDefaultChain(): FallbackSearchProvider {
  return new FallbackSearchProvider([
    { name: 'sogou', provider: new SogouScrapeSearchProvider() },
    { name: 'bing', provider: new BingScrapeSearchProvider() },
  ]);
}

/** canary 结论：true = sogou 被反爬拦截（回退分支）；false = 原链分支。 */
let sogouChallenged = false;

beforeAll(async () => {
  if (!ENABLE_NETWORK_TESTS) return;
  try {
    sogouChallenged = await new SogouScrapeSearchProvider().probeChallenged('hello world');
  } catch (err) {
    // 环境错误（网络全断）：显式 fail 并注明环境原因——非代码回归。
    throw new Error(
      `[环境错误] sogou canary 探针网络失败（出口不可达属环境红；provider 链回退只兜反爬拦截，兜不住断网）：${String(err)}`
    );
  }
  console.log(
    `[sogou canary] challenged=${sogouChallenged} → 本轮断言走${
      sogouChallenged ? '回退（bing）' : '原链（sogou）'
    }分支`
  );
});

/**
 * provider 来源标记断言：
 * - 被拦（canary）：严格 'bing'——证明回退真实发生，而非空结果蒙混。
 * - 未拦：接受 'sogou' | 'bing'——容忍查询期间风控突袭（回退同样正确）。
 */
function expectProviderMark(result: { provider?: string }): void {
  if (sogouChallenged) {
    expect(result.provider).toBe('bing');
  } else {
    expect(['sogou', 'bing']).toContain(result.provider);
  }
}

describe('web_search sogou→bing provider chain (live, dual-mode)', () => {
  itif(ENABLE_NETWORK_TESTS)(
    'returns results for a common English query with provider source mark',
    async () => {
      const results = await createDefaultChain().search('TypeScript tutorial');
      expect(results.length).toBeGreaterThanOrEqual(3);

      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.url).toMatch(/^https?:\/\//);
        expect(r.snippet).toBeTruthy();
        expectProviderMark(r);
      }

      // 相关性断言只对 sogou 结果有意义：bing 从国内出口对英文查询常返回
      // 不相关内容（sogou 为主链的原因，见 provider 文档）——回退分支的
      // 有效性由「真结果 ≥3 + provider 标记 bing」保证，不强求查询相关。
      const usedSogou = results[0]?.provider === 'sogou';
      if (usedSogou) {
        const hasTypeScript = results.some(
          (r) =>
            r.title.toLowerCase().includes('typescript') ||
            r.snippet.toLowerCase().includes('typescript')
        );
        expect(hasTypeScript).toBe(true);
      }
    },
    30000
  );

  itif(ENABLE_NETWORK_TESTS)(
    'returns results for a Chinese query with provider source mark',
    async () => {
      const results = await createDefaultChain().search('Python 入门教程');
      expect(results.length).toBeGreaterThanOrEqual(3);

      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.url).toMatch(/^https?:\/\//);
        expectProviderMark(r);
      }
    },
    30000
  );

  itif(ENABLE_NETWORK_TESTS)(
    'returns results for a technical query with special characters',
    async () => {
      const results = await createDefaultChain().search('node.js stream.pipe() usage');
      expect(results.length).toBeGreaterThanOrEqual(3);

      for (const r of results) {
        expect(r.title).toBeTruthy();
        expect(r.url).toMatch(/^https?:\/\//);
        expectProviderMark(r);
      }
    },
    30000
  );

  itif(ENABLE_NETWORK_TESTS)(
    'consecutive searches return consistent structure',
    async () => {
      const chain = createDefaultChain();
      const results1 = await chain.search('React hooks');
      const results2 = await chain.search('Vue composition API');

      expect(results1.length).toBeGreaterThanOrEqual(3);
      expect(results2.length).toBeGreaterThanOrEqual(3);

      for (const results of [results1, results2]) {
        for (const r of results) {
          expect(r).toHaveProperty('title');
          expect(r).toHaveProperty('url');
          expect(r).toHaveProperty('snippet');
          expectProviderMark(r);
        }
      }

      const titles1 = new Set(results1.map((r) => r.title));
      const titles2 = new Set(results2.map((r) => r.title));
      const overlap = [...titles1].filter((t) => titles2.has(t));
      expect(overlap.length).toBeLessThan(results1.length);
    },
    30000
  );

  itif(ENABLE_NETWORK_TESTS)(
    'direct sogou provider: parses live page when unblocked, degrades to [] when challenged',
    async () => {
      const direct = new SogouScrapeSearchProvider();
      const results = await direct.search('TypeScript tutorial');

      if (sogouChallenged) {
        // 被拦分支的真断言：直连 provider 优雅降级为 []（不抛错）——
        // 结果兜底由回退链负责（上方链级用例已断言 bing 真结果）。
        expect(results).toEqual([]);
      } else {
        // 未拦分支的真断言：原 sogou live 断言（选择器对真实页面的解析）。
        expect(results.length).toBeGreaterThanOrEqual(3);
        for (const r of results) {
          expect(r.title).toBeTruthy();
          expect(r.url).toMatch(/^https?:\/\//);
        }
      }
    },
    30000
  );
});

/**
 * E2E Integration Test: LLM uses web_search tool with the default
 * sogou→bing fallback chain (mirrors production assembly).
 */

describe('web_search with sogou→bing fallback chain (LLM E2E)', () => {
  beforeAll(() => {
    if (testConfig.enabled) {
      console.log(
        `[Web Search E2E] Provider: ${testConfig.provider}, Model: ${testConfig.testModel}`
      );
    }
  });

  function createSearchRunner() {
    const tools = [createWebSearchTool(createDefaultChain())];

    return new AgentRunner({
      model: testConfig.testModel,
      llmClient: LLMClient.quickInit({
        providers: [
          {
            name: testConfig.provider,
            apiKey: testConfig.apiKey,
            baseUrl: testConfig.baseUrl,
            models: [{ modelId: testConfig.testModel }],
          },
        ],
      }),
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
