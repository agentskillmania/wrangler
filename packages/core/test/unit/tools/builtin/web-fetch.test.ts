import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebFetchTool } from '../../../../src/tools/builtin/web-fetch.js';

describe('web_fetch', () => {
  const deps = () => ({ workspacePath: '/tmp' });
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
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
    const tool = createWebFetchTool(deps());
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result.output).toContain('Hello');
    expect(result.output).toContain('World');
    expect(result.metadata?.statusCode).toBe(200);
  });

  it('pretty-prints JSON', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'application/json',
      body: '{"name":"test","value":42}',
    });
    const tool = createWebFetchTool(deps());
    const result = await tool.execute({ url: 'https://api.example.com' });
    expect(result.output).toContain('"name": "test"');
    expect(result.metadata?.contentType).toContain('application/json');
  });

  it('returns plain text as-is', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'text/plain',
      body: 'Hello plain text',
    });
    const tool = createWebFetchTool(deps());
    const result = await tool.execute({ url: 'https://example.com/readme.txt' });
    expect(result.output).toBe('Hello plain text');
  });

  it('returns error for invalid URL', async () => {
    const tool = createWebFetchTool(deps());
    const result = await tool.execute({ url: 'not-a-url' });
    expect(result.output).toContain('Invalid URL');
  });

  it('returns error for HTTP error status', async () => {
    mockFetch({
      ok: false,
      status: 404,
      contentType: 'text/html',
      body: 'Not Found',
    });
    const tool = createWebFetchTool(deps());
    const result = await tool.execute({ url: 'https://example.com/missing' });
    expect(result.output).toContain('HTTP 404');
  });

  it('returns error for unsupported content type', async () => {
    mockFetch({
      ok: true,
      status: 200,
      contentType: 'application/pdf',
      body: '%PDF-1.4',
    });
    const tool = createWebFetchTool(deps());
    const result = await tool.execute({ url: 'https://example.com/doc.pdf' });
    expect(result.output).toContain('Unsupported content type');
  });

  it('has correct tool metadata', () => {
    const tool = createWebFetchTool(deps());
    expect(tool.name).toBe('web_fetch');
    expect(tool.parameters).toBeDefined();
  });
});
