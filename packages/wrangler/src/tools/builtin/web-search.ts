import type { Tool } from '@agentskillmania/colts';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /**
   * 来源 provider 标记（'sogou' | 'bing' | ...）——回退链对结果盖戳，
   * 便于前端/测试区分本次结果实际来自哪个引擎（R2P-243）。
   */
  provider?: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchResult[]>;
  /**
   * 带挑战信号的搜索（可选）：能区分「被反爬风控拦截」与「真无结果」的
   * provider 实现（如 sogou antispider 403/302）。回退链据此切换 provider。
   * 只实现 search() 的 provider 在链中被视为永不挑战——信号缺失即不回退
   * （回退链构造者需保证主链 provider 带本信号，否则链退化为直连）。
   */
  searchDetailed?(query: string): Promise<SearchOutcome>;
}

/** searchDetailed 的返回：challenged=true 表示被反爬拦截（结果为空）。 */
export interface SearchOutcome {
  results: SearchResult[];
  challenged?: boolean;
}

/** 回退链节：命名 provider（name 用作结果来源标记）。 */
export interface NamedSearchProvider {
  name: string;
  provider: SearchProvider;
}

/**
 * Provider 链回退（R2P-243）：primary 被反爬挑战（searchDetailed 报
 * challenged）时用下一节重试同查询；未被挑战（含真无结果）不回退。
 * 返回结果统一盖 `provider` 来源标记。
 */
export class FallbackSearchProvider implements SearchProvider {
  constructor(private readonly chain: NamedSearchProvider[]) {
    if (chain.length === 0) {
      throw new Error('FallbackSearchProvider requires at least one provider');
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    for (const { name, provider } of this.chain) {
      const outcome = provider.searchDetailed
        ? await provider.searchDetailed(query)
        : { results: await provider.search(query) };
      if (!outcome.challenged) {
        return outcome.results.map((r) => ({ ...r, provider: r.provider ?? name }));
      }
      // 被挑战 → 下一节用同查询重试
    }
    // 全链被拦：空结果兜底（web_search 显示 No results found，不抛错）
    return [];
  }
}

const WebSearchSchema = z.object({
  query: z.string().describe('Search query'),
});

export function createWebSearchTool(searchProvider: SearchProvider): Tool<ZodTypeAny> {
  return {
    name: 'web_search',
    description:
      'Search the web. Automatically falls back to an alternate search engine when the primary one blocks the request.',
    parameters: WebSearchSchema,
    async execute(args: z.infer<typeof WebSearchSchema>) {
      const results = await searchProvider.search(args.query);
      if (results.length === 0) {
        return `No results found for "${args.query}"`;
      }
      const output = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');
      return output;
    },
  };
}
