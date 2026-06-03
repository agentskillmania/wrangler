import { JSDOM } from 'jsdom';

import type { SearchProvider, SearchResult } from './web-search.js';

/**
 * Zero-config search provider using Bing HTML scraping.
 *
 * Uses fetch + browser User-Agent + JSDOM CSS selectors.
 * No API key or registration required.
 *
 * CSS selectors (stable for years):
 * - Result container: li.b_algo
 * - Title + URL: li.b_algo > h2 > a (textContent=title, href=url)
 * - Snippet: .b_lineclamp2 or p fallback
 */
export class BingScrapeSearchProvider implements SearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!response.ok) return [];
      html = await response.text();
    } catch {
      return [];
    }

    return this.parseResults(html);
  }

  private parseResults(html: string): SearchResult[] {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const results: SearchResult[] = [];

    const algoItems = doc.querySelectorAll('li.b_algo');
    for (const item of algoItems) {
      const link = item.querySelector('h2 > a');
      const snippetEl = item.querySelector('.b_lineclamp2') ?? item.querySelector('p');

      if (!link) continue;

      const title = link.textContent?.trim() ?? '';
      const href = link.getAttribute('href') ?? '';
      const snippet = snippetEl?.textContent?.trim() ?? '';

      if (title && href) {
        results.push({ title, url: href, snippet });
      }

      if (results.length >= 10) break;
    }

    return results;
  }
}
