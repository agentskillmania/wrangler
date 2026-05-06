import { describe, it, expect } from 'vitest';
import { createWebSearchTool } from '../../../../src/tools/builtin/web-search.js';
import type { SearchProvider } from '../../../../src/tools/builtin/web-search.js';

describe('web_search', () => {
  it('returns error when no provider configured', async () => {
    const tool = createWebSearchTool();
    const result = await tool.execute({ query: 'test' });
    expect(result.output).toContain('not configured');
  });

  it('returns formatted results with provider', async () => {
    const provider: SearchProvider = {
      search: async () => [
        { title: 'Result 1', url: 'https://example.com/1', snippet: 'First result' },
        { title: 'Result 2', url: 'https://example.com/2', snippet: 'Second result' },
      ],
    };
    const tool = createWebSearchTool(provider);
    const result = await tool.execute({ query: 'test' });
    expect(result.output).toContain('Result 1');
    expect(result.output).toContain('https://example.com/1');
    expect(result.metadata?.results.length).toBe(2);
  });

  it('returns no results message for empty response', async () => {
    const provider: SearchProvider = { search: async () => [] };
    const tool = createWebSearchTool(provider);
    const result = await tool.execute({ query: 'obscure' });
    expect(result.output).toContain('No results found');
  });

  it('returns error when provider throws', async () => {
    const provider: SearchProvider = {
      search: async () => {
        throw new Error('API error');
      },
    };
    const tool = createWebSearchTool(provider);
    const result = await tool.execute({ query: 'test' });
    expect(result.output).toContain('Search failed');
  });

  it('has correct tool metadata', () => {
    const tool = createWebSearchTool();
    expect(tool.name).toBe('web_search');
    expect(tool.parameters).toBeDefined();
  });
});
