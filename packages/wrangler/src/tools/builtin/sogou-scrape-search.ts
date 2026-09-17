import { JSDOM } from 'jsdom';

import type { SearchOutcome, SearchProvider, SearchResult } from './web-search.js';

const SOGOU_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** 搜索页 fetch 形状（redirect: 'manual'——保留 302→antispider 挑战原貌）。 */
function fetchSearchPage(query: string): Promise<Response> {
  return fetch(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': SOGOU_UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    redirect: 'manual',
  });
}

/** 挑战响应的最小结构（测试 mock 可用普通对象满足）。 */
interface ChallengeProbeResponse {
  status: number;
  url?: string;
  headers?: { get(name: string): string | null };
}

/**
 * sogou antispider 挑战特征判定（R2P-243）：
 * - 裸 HTTP 403
 * - 3xx 重定向且 Location 指向 antispider（302→/antispider/）
 * - 落地 URL 含 antispider（防御：被跟随重定向吞掉 302 的场景）
 */
function isChallengeResponse(response: ChallengeProbeResponse): boolean {
  if (response.status === 403) return true;
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers?.get('location') ?? '';
    return location.includes('antispider');
  }
  return (response.url ?? '').includes('antispider');
}

/**
 * Zero-config search provider using Sogou HTML scraping.
 *
 * Works reliably from China where Bing returns irrelevant results.
 * Uses fetch + browser User-Agent + JSDOM CSS selectors.
 * No API key or registration required.
 *
 * URL resolution: Sogou returns encrypted redirect URLs (/link?url=...).
 * Following each redirect reveals the real URL via window.location.replace().
 * We resolve up to 5 URLs concurrently to avoid serial latency.
 *
 * Antispider risk control (R2P-243): sogou 是 IP 计分的动态风控，进程内
 * 客户端随时可能被 302→antispider 挑战或裸 403。searchDetailed 会以
 * challenged=true 上报该状态，供回退链（FallbackSearchProvider）切换 bing。
 *
 * CSS selectors (sogou 2025 page revision — vrwrap containers no longer
 * carry the old `30000000` ids, titles moved from `h3 a[name="dttl"]` to
 * `h3.vr-title > a[target="_blank"]`, snippets live in `p.star-wiki`):
 * - Result container: div.vrwrap (organic results)
 * - Title + URL: h3.vr-title a[target="_blank"] (textContent=title, href
 *   is either an absolute URL or a sogou /link?url=... redirect)
 * - Snippet: p.star-wiki
 */
export class SogouScrapeSearchProvider implements SearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    const outcome = await this.searchDetailed(query);
    return outcome.results;
  }

  /**
   * 带挑战信号的搜索：被反爬拦截（403 / 302→antispider）时返回
   * { results: [], challenged: true }；真无结果/网络故障仍优雅返回空
   * （challenged=false，不抛错——与 search 的既有降级契约一致）。
   */
  async searchDetailed(query: string): Promise<SearchOutcome> {
    let html: string;
    try {
      const response = await fetchSearchPage(query);
      if (isChallengeResponse(response)) {
        return { results: [], challenged: true };
      }
      if (!response.ok) return { results: [], challenged: false };
      html = await response.text();
    } catch {
      return { results: [], challenged: false };
    }

    const rawResults = this.parseResults(html);
    if (rawResults.length === 0) return { results: [], challenged: false };

    return { results: await this.resolveUrls(rawResults), challenged: false };
  }

  /**
   * 轻量探针（canary 用）：一次请求判定当前出口是否被 sogou 风控拦截，
   * 不做解析与重定向解析。网络故障时抛错（区别于「被拦」）——调用方可
   * 按环境错误处理（如测试显式 fail 并注明环境原因）。
   */
  async probeChallenged(query = 'hello'): Promise<boolean> {
    const response = await fetchSearchPage(query);
    return isChallengeResponse(response);
  }

  /**
   * Parse Sogou HTML into raw results with Sogou redirect URLs.
   *
   * Only extracts organic web results (div.vrwrap), skipping image cards,
   * knowledge panels, and ads.
   */
  private parseResults(html: string): Array<{ title: string; url: string; snippet: string }> {
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const items = doc.querySelectorAll('div.vrwrap');
    for (const item of items) {
      // Title link: h3.vr-title > a[target="_blank"] (absolute URL or
      // /link?url=... redirect).
      const link = item.querySelector('h3 a[target="_blank"]');
      if (!link) continue;

      const title = link.textContent?.trim() ?? '';
      const href = link.getAttribute('href') ?? '';
      // Snippet lives in p.star-wiki on most results; some blocks (e.g.
      // zhihu cards) use .fz-mid instead — keep the fallback.
      const snippetEl = item.querySelector('p.star-wiki') ?? item.querySelector('.fz-mid');
      const snippet = snippetEl?.textContent?.trim() ?? '';

      if (title && href) {
        results.push({ title, url: href, snippet });
      }

      if (results.length >= 10) break;
    }

    return results;
  }

  /**
   * Resolve Sogou encrypted redirect URLs to real URLs.
   *
   * Sogou redirect pages contain window.location.replace("REAL_URL").
   * We fetch each redirect URL and extract the real URL from the response.
   * Processes up to 5 URLs concurrently to balance speed vs server load.
   */
  private async resolveUrls(
    results: Array<{ title: string; url: string; snippet: string }>
  ): Promise<SearchResult[]> {
    const CONCURRENCY = 5;
    const resolved: SearchResult[] = [];

    for (let i = 0; i < results.length; i += CONCURRENCY) {
      const batch = results.slice(i, i + CONCURRENCY);
      const urls = await Promise.all(
        batch.map(async (r) => {
          // Already absolute URL (shouldn't happen but handle gracefully)
          if (r.url.startsWith('http')) return r.url;
          return this.resolveRedirect(r.url);
        })
      );

      for (let j = 0; j < batch.length; j++) {
        resolved.push({
          title: batch[j].title,
          url: urls[j] || `https://www.sogou.com${batch[j].url}`,
          snippet: batch[j].snippet,
        });
      }
    }

    return resolved;
  }

  /**
   * Follow a single Sogou redirect URL and extract the real target.
   *
   * The redirect page contains:
   *   <script>window.location.replace("https://real-url.com")</script>
   */
  private async resolveRedirect(sogouPath: string): Promise<string> {
    try {
      const response = await fetch(`https://www.sogou.com${sogouPath}`, {
        headers: {
          'User-Agent': SOGOU_UA,
        },
        redirect: 'manual',
      });
      // Check for HTTP redirect first (302/301)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) return location;
      }
      // Otherwise extract from JS redirect in body
      const body = await response.text();
      const match = body.match(/window\.location\.replace\("([^"]+)"\)/);
      if (match) return match[1];

      // Fallback: check meta refresh
      const metaMatch = body.match(/URL='([^']+)'/);
      if (metaMatch) return metaMatch[1];
    } catch {
      // Resolution failed, fall back to Sogou redirect URL
    }
    return '';
  }
}
