/**
 * Unit tests: SogouScrapeSearchProvider degradation & parsing contracts.
 *
 * Live sogou scraping is covered by test/integration/sogou-search.test.ts,
 * which is TEMPORARILY excluded (vitest.config.ts) while sogou's antispider
 * risk-gate challenges non-browser clients from this network. These unit
 * tests pin the contracts that remain testable offline:
 *   1. Blocked (HTTP 403 / antispider) → graceful [] (no throw) — the
 *      behavior real users get whenever the risk gate trips.
 *   2. Network failure → graceful [] (no throw).
 *   3. Selector contract: given a real-shaped sogou results page (fixture),
 *      organic vrwrap items parse into {title, url, snippet}.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SogouScrapeSearchProvider } from '../../../src/tools/builtin/sogou-scrape-search.js';

/** Minimal sogou-shaped results page: 2 organic vrwrap items + 1 ad card. */
const FIXTURE_HTML = `
<html><body>
<div class="vrwrap"><h3 class="vr-title"><a target="_blank" href="/link?url=abc123">TypeScript Tutorial Site</a></h3>
  <p class="star-wiki">Learn TypeScript from the official handbook.</p></div>
<div class="vrwrap"><h3 class="vr-title"><a target="_blank" href="/link?url=def456">TS Study Guide</a></h3>
  <p class="star-wiki">A community guide to TypeScript basics.</p></div>
<div class="vrwrap-promote"><h3><a href="/link?url=ad1">Buy TypeScript Course</a></h3></div>
</body></html>
`;

describe('SogouScrapeSearchProvider (offline contracts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns [] without throwing when sogou answers HTTP 403 (antispider risk gate)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('forbidden') })
    );
    const provider = new SogouScrapeSearchProvider();
    await expect(provider.search('TypeScript tutorial')).resolves.toEqual([]);
  });

  it('returns [] without throwing when the network request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const provider = new SogouScrapeSearchProvider();
    await expect(provider.search('TypeScript tutorial')).resolves.toEqual([]);
  });

  it('parses organic vrwrap items into title/url/snippet from fixture HTML', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(FIXTURE_HTML),
    });
    // Redirect resolution: resolveRedirect also fetches /link?url=… — return
    // a location.replace payload so resolved urls are real.
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/link?url=abc123')) {
        return {
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve('<script>window.location.replace("https://ts.dev/handbook")</script>'),
        };
      }
      return { ok: true, status: 200, text: () => Promise.resolve(FIXTURE_HTML) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SogouScrapeSearchProvider();
    const results = await provider.search('TypeScript tutorial');

    expect(results).toHaveLength(2); // ad card (vrwrap-promote) must be skipped
    expect(results[0]).toMatchObject({
      title: 'TypeScript Tutorial Site',
      url: 'https://ts.dev/handbook',
      snippet: 'Learn TypeScript from the official handbook.',
    });
    expect(results[1]?.title).toBe('TS Study Guide');
    expect(results[1]?.url).toMatch(/^https?:\/\//); // unresolved → sogou fallback prefix
  });
});
