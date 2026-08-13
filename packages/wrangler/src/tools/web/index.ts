/**
 * @agentskillmania/wrangler/tools/web —— Node 专属的网页工具（jsdom 爬虫）。
 *
 * wrangler 主入口不包含本模块（web_fetch/web_search 依赖 jsdom/readability/
 * turndown，浏览器不可用）。Node 宿主（daemon 等）从本子路径组装后经
 * EnhancedRunner 的 tools.inject 注入。
 *
 * @example
 * ```typescript
 * import { createWebTools } from '@agentskillmania/wrangler/tools/web';
 * const webTools = createWebTools({ deps, provider: options.search?.provider });
 * await EnhancedRunner.create({ ..., tools: { inject: webTools } });
 * ```
 */

import type { Tool } from '@agentskillmania/colts';
import type { ZodTypeAny } from 'zod';

import { BingScrapeSearchProvider } from '../builtin/bing-scrape-search.js';
import { SogouScrapeSearchProvider } from '../builtin/sogou-scrape-search.js';
import { createWebFetchTool } from '../builtin/web-fetch.js';
import type { SearchProvider } from '../builtin/web-search.js';
import { createWebSearchTool } from '../builtin/web-search.js';
import type { ToolDeps } from '../builtin/workspace-deps.js';

export interface WebToolsOptions {
  /** 工具依赖（宿主构造：Node 用 HostToolDeps / SandboxToolDeps） */
  deps: ToolDeps;
  /** 搜索 provider 实例或名称（默认 sogou，与引擎原行为一致） */
  provider?: SearchProvider | 'sogou' | 'bing';
}

/** 解析搜索 provider（默认 sogou——与引擎/Rust 原行为一致） */
function resolveSearchProvider(provider?: SearchProvider | 'sogou' | 'bing'): SearchProvider {
  if (!provider || provider === 'sogou') return new SogouScrapeSearchProvider();
  if (provider === 'bing') return new BingScrapeSearchProvider();
  return provider;
}

/** 组装 web_fetch + web_search（Node 专属，主入口不含） */
export function createWebTools(options: WebToolsOptions): Tool<ZodTypeAny>[] {
  const searchProvider = resolveSearchProvider(options.provider);
  return [createWebFetchTool(options.deps), createWebSearchTool(searchProvider)];
}

export { createWebFetchTool } from '../builtin/web-fetch.js';
export { createWebSearchTool } from '../builtin/web-search.js';
export { SogouScrapeSearchProvider } from '../builtin/sogou-scrape-search.js';
export { BingScrapeSearchProvider } from '../builtin/bing-scrape-search.js';
export type { SearchProvider, SearchResult } from '../builtin/web-search.js';
