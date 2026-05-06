/**
 * User Story: US3 注册联网工具
 *
 * 作为开发者，我获取 web_fetch 工具（web_search 需要注入 SearchProvider），
 * agent 可以抓取网页内容。
 *
 * Prerequisites: None (web_search tested via stub, web_fetch uses mock)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebFetchTool } from '../../src/tools/builtin/web-fetch.js';
import { createWebSearchTool } from '../../src/tools/builtin/web-search.js';
import type { SearchProvider } from '../../src/tools/builtin/web-search.js';

describe('US3: Web tools', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { ok: boolean; status: number; contentType: string; body: string }) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      headers: new Headers({ 'content-type': response.contentType }),
      text: async () => response.body,
      json: async () => JSON.parse(response.body),
    }) as unknown as typeof globalThis.fetch;
  }

  describe('web_fetch', () => {
    it('fetches and converts HTML to markdown', async () => {
      mockFetch({
        ok: true,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<h1>Title</h1><p>Content paragraph</p><ul><li>Item 1</li><li>Item 2</li></ul>',
      });

      const tool = createWebFetchTool({ workspacePath: '/tmp' });
      const result = await tool.execute({ url: 'https://example.com' });

      expect(result.output).toContain('Title');
      expect(result.output).toContain('Content paragraph');
      expect(result.metadata?.statusCode).toBe(200);
      expect(result.metadata?.contentType).toContain('text/html');
    });

    it('fetches JSON and pretty-prints', async () => {
      mockFetch({
        ok: true,
        status: 200,
        contentType: 'application/json',
        body: '{"name":"wrangler","tools":["file_read","file_write"]}',
      });

      const tool = createWebFetchTool({ workspacePath: '/tmp' });
      const result = await tool.execute({ url: 'https://api.example.com/status' });

      expect(result.output).toContain('"name": "wrangler"');
      expect(result.output).toContain('"file_read"');
      expect(result.metadata?.contentType).toContain('application/json');
    });

    it('returns plain text as-is', async () => {
      mockFetch({
        ok: true,
        status: 200,
        contentType: 'text/plain',
        body: 'Hello, this is plain text content.',
      });

      const tool = createWebFetchTool({ workspacePath: '/tmp' });
      const result = await tool.execute({ url: 'https://example.com/readme.txt' });

      expect(result.output).toBe('Hello, this is plain text content.');
    });

    it('returns error for invalid URL', async () => {
      const tool = createWebFetchTool({ workspacePath: '/tmp' });
      const result = await tool.execute({ url: 'not-a-url' });
      expect(result.output).toContain('Invalid URL');
    });

    it('returns error for HTTP error status', async () => {
      mockFetch({
        ok: false,
        status: 404,
        contentType: 'text/html',
        body: '<html>Not Found</html>',
      });

      const tool = createWebFetchTool({ workspacePath: '/tmp' });
      const result = await tool.execute({ url: 'https://example.com/missing' });
      expect(result.output).toContain('HTTP 404');
    });

    it('returns error for unsupported content type', async () => {
      mockFetch({
        ok: true,
        status: 200,
        contentType: 'application/pdf',
        body: '%PDF-1.4',
      });

      const tool = createWebFetchTool({ workspacePath: '/tmp' });
      const result = await tool.execute({ url: 'https://example.com/doc.pdf' });
      expect(result.output).toContain('Unsupported content type');
    });

    it('handles fetch failure with network error', async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof globalThis.fetch;

      const tool = createWebFetchTool({ workspacePath: '/tmp' });
      const result = await tool.execute({ url: 'https://unreachable.example.com' });
      expect(result.output).toContain('Failed to fetch');
      expect(result.output).toContain('ECONNREFUSED');
    });
  });

  describe('web_search', () => {
    it('returns stub message when no SearchProvider configured', async () => {
      const tool = createWebSearchTool();
      const result = await tool.execute({ query: 'wrangler agent framework' });
      expect(result.output).toContain('not configured');
    });

    it('returns formatted search results via provider', async () => {
      const provider: SearchProvider = {
        search: async (query) => [
          {
            title: `Result for: ${query}`,
            url: 'https://example.com/1',
            snippet: 'This is the first result snippet.',
          },
          {
            title: 'Another result',
            url: 'https://example.com/2',
            snippet: 'Second result with more context.',
          },
        ],
      };

      const tool = createWebSearchTool(provider);
      const result = await tool.execute({ query: 'wrangler agent framework' });

      expect(result.output).toContain('Result for: wrangler agent framework');
      expect(result.output).toContain('https://example.com/1');
      expect(result.output).toContain('Another result');
      expect(result.metadata?.results).toHaveLength(2);
    });

    it('returns "no results" message when provider returns empty', async () => {
      const provider: SearchProvider = { search: async () => [] };
      const tool = createWebSearchTool(provider);
      const result = await tool.execute({ query: 'obscure query xyzzy' });
      expect(result.output).toContain('No results found');
    });

    it('handles provider error gracefully', async () => {
      const provider: SearchProvider = {
        search: async () => {
          throw new Error('API rate limit exceeded');
        },
      };
      const tool = createWebSearchTool(provider);
      const result = await tool.execute({ query: 'test' });
      expect(result.output).toContain('Search failed');
      expect(result.output).toContain('API rate limit exceeded');
    });
  });
});
