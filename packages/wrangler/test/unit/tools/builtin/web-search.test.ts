import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWebSearchTool } from '../../../../src/tools/builtin/web-search.js';
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
