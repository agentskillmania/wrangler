import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BingScrapeSearchProvider } from '../../../../src/tools/builtin/bing-scrape-search.js';
import type { SearchResult } from '../../../../src/tools/builtin/web-search.js';

describe('BingScrapeSearchProvider', () => {
  let provider: BingScrapeSearchProvider;

  beforeEach(() => {
    provider = new BingScrapeSearchProvider();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const results = await provider.search('test query');
    expect(results).toEqual([]);
  });

  it('returns empty array on non-200 response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    } as Response);

    const results = await provider.search('test query');
    expect(results).toEqual([]);
  });

  it('returns empty array when no results found', async () => {
    const html = `
      <html>
        <body>
          <div>No search results found</div>
        </body>
      </html>
    `;

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    const results = await provider.search('test query');
    expect(results).toEqual([]);
  });

  it('parses search results correctly', async () => {
    const html = `
      <html>
        <body>
          <li class="b_algo">
            <h2><a href="https://example.com/1">First Result</a></h2>
            <p class="b_lineclamp2">First snippet text</p>
          </li>
          <li class="b_algo">
            <h2><a href="https://example.com/2">Second Result</a></h2>
            <p>Second snippet text</p>
          </li>
        </body>
      </html>
    `;

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    const results = await provider.search('test query');
    expect(results).toEqual([
      {
        title: 'First Result',
        url: 'https://example.com/1',
        snippet: 'First snippet text',
      },
      {
        title: 'Second Result',
        url: 'https://example.com/2',
        snippet: 'Second snippet text',
      },
    ]);
  });

  it('handles missing snippet gracefully', async () => {
    const html = `
      <html>
        <body>
          <li class="b_algo">
            <h2><a href="https://example.com/1">Result No Snippet</a></h2>
          </li>
        </body>
      </html>
    `;

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    const results = await provider.search('test query');
    expect(results).toEqual([
      {
        title: 'Result No Snippet',
        url: 'https://example.com/1',
        snippet: '',
      },
    ]);
  });

  it('handles missing link gracefully', async () => {
    const html = `
      <html>
        <body>
          <li class="b_algo">
            <div>No link here</div>
          </li>
          <li class="b_algo">
            <h2><a href="https://example.com/2">Valid Result</a></h2>
          </li>
        </body>
      </html>
    `;

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    const results = await provider.search('test query');
    expect(results).toEqual([
      {
        title: 'Valid Result',
        url: 'https://example.com/2',
        snippet: '',
      },
    ]);
  });

  it('limits results to 10', async () => {
    const html = `
      <html>
        <body>
          ${Array.from({ length: 15 }, (_, i) => `
            <li class="b_algo">
              <h2><a href="https://example.com/${i}">Result ${i}</a></h2>
              <p>Snippet ${i}</p>
            </li>
          `).join('')}
        </body>
      </html>
    `;

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => html,
    } as Response);

    const results = await provider.search('test query');
    expect(results).toHaveLength(10);
  });

  it('encodes query parameter correctly', async () => {
    const encodedQuery = encodeURIComponent('test with spaces & special chars');
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      expect(url).toBe(`https://www.bing.com/search?q=${encodedQuery}`);
      return Promise.resolve({
        ok: true,
        text: async () => '<html><body></body></html>',
      } as Response);
    });

    await provider.search('test with spaces & special chars');
  });
});