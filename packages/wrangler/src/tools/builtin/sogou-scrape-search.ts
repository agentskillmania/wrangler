import { JSDOM } from 'jsdom';

import type { SearchProvider, SearchResult } from './web-search.js';

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
    const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      if (!response.ok) return [];
      html = await response.text();
    } catch {
      return [];
    }

    const rawResults = this.parseResults(html);
    if (rawResults.length === 0) return [];

    return this.resolveUrls(rawResults);
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
      const snippetEl =
        item.querySelector('p.star-wiki') ?? item.querySelector('.fz-mid');
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
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
