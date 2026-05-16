import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebFetchTool } from '../../../../src/tools/builtin/web-fetch.js';
import { HostToolDeps } from '../../../../src/tools/builtin/workspace-deps.js';

describe('web_fetch', () => {
  let deps: HostToolDeps;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    deps = new HostToolDeps('/tmp');
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { ok: boolean; status: number; contentType: string; body: string }) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      headers: new Headers({ 'content-type': response.contentType }),
      text: async () => response.body,
      json: async () => JSON.parse(response.body),
    }) as unknown as typeof globalThis.fetch;
  }

  it('converts HTML to markdown', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<h1>Hello</h1><p>World</p>',
    });
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('pretty-prints JSON', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'application/json',
      body: '{"name":"test","value":42}',
    });
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://api.example.com' });
    expect(result).toContain('"name": "test"');
  });

  it('returns plain text as-is', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'text/plain',
      body: 'Hello plain text',
    });
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://example.com/readme.txt' });
    expect(result).toBe('Hello plain text');
  });

  it('returns error for invalid URL', async () => {
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'not-a-url' });
    expect(result).toContain('Invalid URL');
  });

  it('returns error for HTTP error status', async () => {
    mockFetch({
      ok: false,
      status: 404,
      contentType: 'text/html',
      body: 'Not Found',
    });
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://example.com/missing' });
    expect(result).toContain('HTTP 404');
  });

  it('returns error for unsupported content type', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'application/pdf',
      body: '%PDF-1.4',
    });
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://example.com/doc.pdf' });
    expect(result).toContain('Unsupported content type');
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof globalThis.fetch;
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://unreachable.example.com' });
    expect(result).toContain('Failed to fetch');
    expect(result).toContain('ECONNREFUSED');
  });

  it('handles response with no content-type header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'some text',
    }) as unknown as typeof globalThis.fetch;
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://example.com/binary' });
    expect(result).toContain('Unsupported content type');
  });

  it('has correct tool metadata', () => {
    const tool = createWebFetchTool(deps);
    expect(tool.name).toBe('web_fetch');
    expect(tool.parameters).toBeDefined();
  });

  it('falls back to raw HTML when Readability finds no article', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><div>raw content without article structure</div></body></html>',
    });
    const tool = createWebFetchTool(deps);
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result).toContain('raw content');
  });
});
