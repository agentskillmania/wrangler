import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createWebSearchTool,
  FallbackSearchProvider,
} from '../../../../src/tools/builtin/web-search.js';
import type { SearchProvider } from '../../../../src/tools/builtin/web-search.js';
import { BingScrapeSearchProvider } from '../../../../src/tools/builtin/bing-scrape-search.js';

describe('web_search', () => {
  it('returns formatted results with provider', async () => {
    const provider: SearchProvider = {
      search: async () => [
        { title: 'Result 1', url: 'https://example.com/1', snippet: 'First result' },
        { title: 'Result 2', url: 'https://example.com/2', snippet: 'Second result' },
      ],
    };
    const tool = createWebSearchTool(provider);
    const result = await tool.execute({ query: 'test' });
    expect(result).toContain('Result 1');
    expect(result).toContain('https://example.com/1');
  });

  it('returns no results message for empty response', async () => {
    const provider: SearchProvider = { search: async () => [] };
    const tool = createWebSearchTool(provider);
    const result = await tool.execute({ query: 'obscure' });
    expect(result).toContain('No results found');
  });

  it('throws when provider throws', async () => {
    const provider: SearchProvider = {
      search: async () => {
        throw new Error('API error');
      },
    };
    const tool = createWebSearchTool(provider);
    await expect(tool.execute({ query: 'test' })).rejects.toThrow('API error');
  });

  it('has correct tool metadata', () => {
    const provider: SearchProvider = { search: async () => [] };
    const tool = createWebSearchTool(provider);
    expect(tool.name).toBe('web_search');
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });

  it('accepts BingScrapeSearchProvider', async () => {
    const provider = new BingScrapeSearchProvider();
    const tool = createWebSearchTool(provider);
    expect(tool.name).toBe('web_search');
  });
});

describe('FallbackSearchProvider (R2P-243 sogou→bing 回退链)', () => {
  /** 无 searchDetailed 的普通 provider（走 search 通路）。 */
  const plainProvider = (results: ReturnType<typeof vi.fn>): SearchProvider => ({
    search: results,
  });

  it('primary 未被挑战 → 直接返回 primary 结果并盖 primary 来源标记', async () => {
    const primary = plainProvider(
      vi.fn().mockResolvedValue([{ title: 'S1', url: 'https://sogou.com/1', snippet: 'a' }])
    );
    const secondary = plainProvider(
      vi.fn().mockResolvedValue([{ title: 'B1', url: 'https://bing.com/1', snippet: 'b' }])
    );
    const chain = new FallbackSearchProvider([
      { name: 'sogou', provider: primary },
      { name: 'bing', provider: secondary },
    ]);

    const results = await chain.search('query');

    expect(results).toEqual([
      { title: 'S1', url: 'https://sogou.com/1', snippet: 'a', provider: 'sogou' },
    ]);
    expect(secondary.search).not.toHaveBeenCalled();
  });

  it('primary 被挑战（challenged: true）→ 同查询回退 secondary 并盖 bing 标记', async () => {
    const primary: SearchProvider = {
      search: vi.fn(),
      searchDetailed: vi.fn().mockResolvedValue({ results: [], challenged: true }),
    };
    const secondary = plainProvider(
      vi.fn().mockResolvedValue([{ title: 'B1', url: 'https://bing.com/1', snippet: 'b' }])
    );
    const chain = new FallbackSearchProvider([
      { name: 'sogou', provider: primary },
      { name: 'bing', provider: secondary },
    ]);

    const results = await chain.search('same query');

    expect(primary.searchDetailed).toHaveBeenCalledWith('same query');
    expect(secondary.search).toHaveBeenCalledWith('same query'); // 同查询重试
    expect(results).toEqual([
      { title: 'B1', url: 'https://bing.com/1', snippet: 'b', provider: 'bing' },
    ]);
  });

  it('primary 真无结果（未挑战）→ 不回退，返回空', async () => {
    const primary = plainProvider(vi.fn().mockResolvedValue([]));
    const secondary = plainProvider(
      vi.fn().mockResolvedValue([{ title: 'B1', url: 'https://bing.com/1', snippet: 'b' }])
    );
    const chain = new FallbackSearchProvider([
      { name: 'sogou', provider: primary },
      { name: 'bing', provider: secondary },
    ]);

    await expect(chain.search('obscure query')).resolves.toEqual([]);
    expect(secondary.search).not.toHaveBeenCalled();
  });

  it('全链被挑战 → 返回空结果兜底（不抛错）', async () => {
    const challenged = (): SearchProvider => ({
      search: vi.fn(),
      searchDetailed: vi.fn().mockResolvedValue({ results: [], challenged: true }),
    });
    const chain = new FallbackSearchProvider([
      { name: 'sogou', provider: challenged() },
      { name: 'bing', provider: challenged() },
    ]);

    await expect(chain.search('q')).resolves.toEqual([]);
  });

  it('provider 抛错 → 原样传播（非挑战错误不吞）', async () => {
    const primary: SearchProvider = {
      search: vi.fn().mockRejectedValue(new Error('API error')),
    };
    const chain = new FallbackSearchProvider([{ name: 'sogou', provider: primary }]);

    await expect(chain.search('query')).rejects.toThrow('API error');
  });

  it('结果已带 provider 标记 → 不覆盖既有标记', async () => {
    const primary = plainProvider(
      vi
        .fn()
        .mockResolvedValue([{ title: 'S1', url: 'https://a', snippet: 's', provider: 'custom' }])
    );
    const chain = new FallbackSearchProvider([{ name: 'sogou', provider: primary }]);

    const results = await chain.search('query');
    expect(results[0].provider).toBe('custom');
  });

  it('空链构造 → 抛错', () => {
    expect(() => new FallbackSearchProvider([])).toThrow('at least one provider');
  });

  it('实现 SearchProvider 接口（可直接喂给 createWebSearchTool）', () => {
    const chain = new FallbackSearchProvider([
      { name: 'sogou', provider: plainProvider(vi.fn().mockResolvedValue([])) },
    ]);
    const tool = createWebSearchTool(chain);
    expect(tool.name).toBe('web_search');
    expect(tool.parameters).toBeInstanceOf(z.ZodObject);
  });
});
