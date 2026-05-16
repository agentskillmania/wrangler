import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BingScrapeSearchProvider } from '../../../../src/tools/builtin/bing-scrape-search.js';

describe('BingScrapeSearchProvider', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockBingResponse(html: string) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    }) as unknown as typeof globalThis.fetch;
  }

  it('parses standard Bing results', async () => {
    mockBingResponse(`
      <html><body>
        <li class="b_algo">
          <h2><a href="https://example.com/1">Example Title</a></h2>
          <p class="b_lineclamp2">Example snippet text</p>
        </li>
        <li class="b_algo">
          <h2><a href="https://example.com/2">Second Result</a></h2>
          <p class="b_lineclamp2">Second snippet</p>
        </li>
      </body></html>
    `);
    const provider = new BingScrapeSearchProvider();
    const results = await provider.search('test query');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Example Title',
      url: 'https://example.com/1',
      snippet: 'Example snippet text',
    });
    expect(results[1]).toEqual({
      title: 'Second Result',
      url: 'https://example.com/2',
      snippet: 'Second snippet',
    });
  });

  it('sends correct URL and headers', async () => {
    mockBingResponse('<html><body></body></html>');
    const provider = new BingScrapeSearchProvider();
    await provider.search('hello world');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://www.bing.com/search?q=hello%20world',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('Mozilla'),
        }),
      })
    );
  });

  it('returns empty array for no results', async () => {
    mockBingResponse('<html><body><p>No results</p></body></html>');
    const provider = new BingScrapeSearchProvider();
    const results = await provider.search('obscure');
    expect(results).toEqual([]);
  });

  it('skips results without title or url', async () => {
    mockBingResponse(`
      <html><body>
        <li class="b_algo">
          <h2>No link here</h2>
          <p>Snippet only</p>
        </li>
        <li class="b_algo">
          <h2><a href="https://example.com">Valid Result</a></h2>
          <p>Valid snippet</p>
        </li>
      </body></html>
    `);
    const provider = new BingScrapeSearchProvider();
    const results = await provider.search('test');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Valid Result');
  });

  it('limits results to 10', async () => {
    const items = Array.from(
      { length: 15 },
      (_, i) => `
        <li class="b_algo">
          <h2><a href="https://example.com/${i}">Result ${i}</a></h2>
          <p>Snippet ${i}</p>
        </li>`
    ).join('');
    mockBingResponse(`<html><body>${items}</body></html>`);
    const provider = new BingScrapeSearchProvider();
    const results = await provider.search('test');
    expect(results).toHaveLength(10);
  });

  it('uses fallback p tag when b_lineclamp2 missing', async () => {
    mockBingResponse(`
      <html><body>
        <li class="b_algo">
          <h2><a href="https://example.com">Title</a></h2>
          <p>Fallback snippet</p>
        </li>
      </body></html>
    `);
    const provider = new BingScrapeSearchProvider();
    const results = await provider.search('test');
    expect(results[0]?.snippet).toBe('Fallback snippet');
  });

  it('returns empty on fetch failure', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof globalThis.fetch;
    const provider = new BingScrapeSearchProvider();
    const results = await provider.search('test');
    expect(results).toEqual([]);
  });

  it('returns empty on non-200 status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    }) as unknown as typeof globalThis.fetch;
    const provider = new BingScrapeSearchProvider();
    const results = await provider.search('test');
    expect(results).toEqual([]);
  });
});