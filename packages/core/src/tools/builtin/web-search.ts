import { z } from 'zod';
import type { WranglerToolDef } from '../types.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
}

const WebSearchSchema = z.object({
  query: z.string().describe('Search query'),
});

export function createWebSearchTool(
  searchProvider?: SearchProvider
): WranglerToolDef<typeof WebSearchSchema> {
  return {
    name: 'web_search',
    description: 'Search the web. Requires a SearchProvider to be configured.',
    parameters: WebSearchSchema,
    async execute(args) {
      if (!searchProvider) {
        return {
          output: 'Web search is not configured. Provide a searchProvider to createBuiltinTools().',
        };
      }
      try {
        const results = await searchProvider.search(args.query);
        if (results.length === 0) {
          return { output: `No results found for "${args.query}"` };
        }
        const output = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
          .join('\n\n');
        return { output, metadata: { query: args.query, results } };
      } catch (e) {
        return { output: `Error: Search failed: ${(e as Error).message}` };
      }
    },
  };
}
