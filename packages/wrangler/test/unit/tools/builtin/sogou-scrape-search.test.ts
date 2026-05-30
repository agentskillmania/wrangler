import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SogouScrapeSearchProvider } from '../../../../src/tools/builtin/sogou-scrape-search.js';

describe('SogouScrapeSearchProvider', () => {
  let provider: SogouScrapeSearchProvider;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    provider = new SogouScrapeSearchProvider();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  /** Build realistic Sogou HTML with organic results and non-organic items. */
  function buildSogouHtml(results: Array<{ title: string; snippet: string; url: string }>): string {
    const items = results
      .map(
        (r, i) => `
      <div class="vrwrap" id="sogou_vr_30000000_wrap_${i + 1}">
        <h3 class="vr-title">
          <a name="dttl" target="_blank" href="${r.url}">${r.title}</a>
        </h3>
        <div class="fz-mid space-txt base-ellipsis clamp2">${r.snippet}</div>
      </div>`
      )
      .join('\n');

    // Include a non-organic result (image card) that should be filtered out
    return `
      <html><body>
        <div class="vrwrap" data-reactroot="">
          <a href="https://pic.sogou.com/pics?...">Image Result</a>
        </div>
        <div class="vrwrap" id="sogou_vr_30010467_2">
          <h3 class="vr-title"><a name="dttl" href="/link?url=ad1">Ad Result</a></h3>
          <div class="fz-mid">This is an ad</div>
        </div>
        ${items}
      </body></html>`;
  }

  /** Build Sogou redirect page that reveals the real URL. */
  function buildRedirectHtml(realUrl: string): string {
    return `<meta content="always" name="referrer"><script>window.location.replace("${realUrl}")</script><noscript><META http-equiv="refresh" content="0;URL='${realUrl}'"></noscript>`;
  }

  it('parses organic results and resolves redirect URLs', async () => {
    const searchHtml = buildSogouHtml([
      { title: 'Result One', snippet: 'First result', url: '/link?url=abc123' },
      { title: 'Result Two', snippet: 'Second result', url: '/link?url=def456' },
    ]);

    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/web?query=')) {
        return new Response(searchHtml, { status: 200 });
      }
      if (url.includes('/link?url=abc123')) {
        return new Response(buildRedirectHtml('https://example.com/one'), { status: 200 });
      }
      if (url.includes('/link?url=def456')) {
        return new Response(buildRedirectHtml('https://example.com/two'), { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const results = await provider.search('test query');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Result One',
      url: 'https://example.com/one',
      snippet: 'First result',
    });
    expect(results[1]).toEqual({
      title: 'Result Two',
      url: 'https://example.com/two',
      snippet: 'Second result',
    });
  });

  it('filters out non-organic results (image cards, ads)', async () => {
    const searchHtml = buildSogouHtml([]);
    fetchSpy.mockResolvedValue(new Response(searchHtml, { status: 200 }));

    const results = await provider.search('test');

    // buildSogouHtml with 0 organic results still has image card + ad
    expect(results).toHaveLength(0);
  });

  it('caps at 10 results', async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      title: `Result ${i + 1}`,
      snippet: `Snippet ${i + 1}`,
      url: `/link?url=item${i}`,
    }));
    const searchHtml = buildSogouHtml(items);

    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/web?query=')) {
        return new Response(searchHtml, { status: 200 });
      }
      return new Response(buildRedirectHtml('https://example.com/resolved'), { status: 200 });
    });

    const results = await provider.search('test');

    expect(results).toHaveLength(10);
  });

  it('returns empty when Sogou returns non-200', async () => {
    fetchSpy.mockResolvedValue(new Response('error', { status: 503 }));

    const results = await provider.search('test');

    expect(results).toHaveLength(0);
  });

  it('returns empty when fetch throws network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const results = await provider.search('test');

    expect(results).toHaveLength(0);
  });

  it('falls back to Sogou redirect URL when resolution fails', async () => {
    const searchHtml = buildSogouHtml([
      { title: 'Unresolvable', snippet: 'Bad redirect', url: '/link?url=bad1' },
    ]);

    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/web?query=')) {
        return new Response(searchHtml, { status: 200 });
      }
      // Redirect resolution fails — returns garbled HTML with no URL
      return new Response('<html>broken</html>', { status: 200 });
    });

    const results = await provider.search('test');

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Unresolvable');
    expect(results[0].url).toBe('https://www.sogou.com/link?url=bad1');
  });

  it('extracts real URL from HTTP 302 redirect', async () => {
    const searchHtml = buildSogouHtml([
      { title: 'HTTP Redirect', snippet: '302 redirect', url: '/link?url=redir302' },
    ]);

    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/web?query=')) {
        return new Response(searchHtml, { status: 200 });
      }
      // Return a 302 redirect
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://example.com/redirected' },
      });
    });

    const results = await provider.search('test');

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com/redirected');
  });

  it('handles result with missing snippet gracefully', async () => {
    const html = `
      <html><body>
        <div class="vrwrap" id="sogou_vr_30000000_wrap_1">
          <h3 class="vr-title">
            <a name="dttl" target="_blank" href="/link?url=snippet-test">Title Only</a>
          </h3>
        </div>
      </body></html>`;

    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/web?query=')) return new Response(html, { status: 200 });
      return new Response(buildRedirectHtml('https://example.com/no-snippet'), { status: 200 });
    });

    const results = await provider.search('test');

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe('');
    expect(results[0].title).toBe('Title Only');
  });

  it('skips results with missing title', async () => {
    const html = `
      <html><body>
        <div class="vrwrap" id="sogou_vr_30000000_wrap_1">
          <h3 class="vr-title">
            <a name="dttl" target="_blank" href="/link?url=no-title"></a>
          </h3>
          <div class="fz-mid">Has snippet but no title</div>
        </div>
      </body></html>`;

    fetchSpy.mockResolvedValue(new Response(html, { status: 200 }));

    const results = await provider.search('test');

    expect(results).toHaveLength(0);
  });

  it('uses Accept-Language header for Chinese content', async () => {
    fetchSpy.mockResolvedValue(new Response('<html></html>', { status: 200 }));

    await provider.search('测试');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/web?query='),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }),
      })
    );
  });

  it('resolves URLs concurrently in batches of 5', async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      title: `Result ${i + 1}`,
      snippet: `Snippet ${i + 1}`,
      url: `/link?url=concurrent${i}`,
    }));
    const searchHtml = buildSogouHtml(items);

    const callOrder: string[] = [];
    fetchSpy.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/web?query=')) {
        return new Response(searchHtml, { status: 200 });
      }
      callOrder.push(url);
      return new Response(buildRedirectHtml(`https://example.com/${url.split('=').pop()}`), {
        status: 200,
      });
    });

    const results = await provider.search('test');

    expect(results).toHaveLength(7);
    // All 7 redirect resolutions were made
    expect(callOrder).toHaveLength(7);
  });
});
