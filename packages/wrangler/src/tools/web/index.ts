/**
 * @agentskillmania/wrangler/tools/web —— Node 专属的网页工具（jsdom 爬虫）。
 *
 * wrangler 主入口不包含本模块（web_fetch/web_search 依赖 jsdom/readability/
 * turndown，浏览器不可用）。Node 宿主（daemon 等）从本子路径组装后经
 * AgentHarness 的 tools.inject 注入。
 *
 * @example
 * ```typescript
 * import { createWebTools } from '@agentskillmania/wrangler/tools/web';
 * const webTools = createWebTools({ deps, provider: options.search?.provider });
 * await AgentHarness.create({ ..., tools: { inject: webTools } });
 * ```
 */

import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { BingScrapeSearchProvider } from '../builtin/bing-scrape-search.js';
import { SogouScrapeSearchProvider } from '../builtin/sogou-scrape-search.js';
import { createWebFetchTool } from '../builtin/web-fetch.js';
import type { SearchProvider } from '../builtin/web-search.js';
import { createWebSearchTool, FallbackSearchProvider } from '../builtin/web-search.js';
import type { ToolDeps } from '../builtin/workspace-deps.js';

export interface WebToolsOptions {
  /** 工具依赖（宿主构造：Node 用 HostToolDeps / SandboxToolDeps） */
  deps: ToolDeps;
  /**
   * 搜索 provider 实例或名称。默认（含显式 'sogou'）为 sogou→bing 回退链：
   * sogou 被反爬挑战（403 / 302→antispider）时自动用 bing 重试同查询，
   * 结果带 provider 来源标记（R2P-243）。
   */
  provider?: SearchProvider | 'sogou' | 'bing';
}

/**
 * 解析搜索 provider。默认（含显式 'sogou'）组装 sogou→bing 回退链——
 * sogou antispider 是 IP 计分的动态风控，随时可能拦截进程内客户端；
 * 被挑战时回退 bing 重试同查询。显式 'bing' 则单用 bing。
 */
function resolveSearchProvider(provider?: SearchProvider | 'sogou' | 'bing'): SearchProvider {
  if (provider === 'bing') return new BingScrapeSearchProvider();
  if (!provider || provider === 'sogou') {
    return new FallbackSearchProvider([
      { name: 'sogou', provider: new SogouScrapeSearchProvider() },
      { name: 'bing', provider: new BingScrapeSearchProvider() },
    ]);
  }
  return provider; // 自定义实例直通（宿主自管回退策略）
}

/** 组装 web_fetch + web_search（Node 专属，主入口不含） */
export function createWebTools(options: WebToolsOptions): Tool<ZodTypeAny>[] {
  const searchProvider = resolveSearchProvider(options.provider);
  return [createWebFetchTool(options.deps), createWebSearchTool(searchProvider)];
}

export { createWebFetchTool } from '../builtin/web-fetch.js';
export { createWebSearchTool, FallbackSearchProvider } from '../builtin/web-search.js';
export { SogouScrapeSearchProvider } from '../builtin/sogou-scrape-search.js';
export { BingScrapeSearchProvider } from '../builtin/bing-scrape-search.js';
export type {
  SearchProvider,
  SearchResult,
  SearchOutcome,
  NamedSearchProvider,
} from '../builtin/web-search.js';
