import type { Tool } from '@agentskillmania/colts';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import type { ToolDeps } from './workspace-deps.js';
import { truncateOutput } from './workspace-deps.js';

const WebFetchSchema = z.object({
  url: z.string().describe('URL to fetch'),
  format: z.enum(['markdown', 'text']).optional().describe('Output format (default: markdown)'),
});

function htmlToMarkdown(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  if (article?.content) {
    return new TurndownService().turndown(article.content);
  }
  return new TurndownService().turndown(html);
}

/**
 * SEC14: Block SSRF attempts by rejecting URLs that resolve to private/loopback/
 * link-local addresses. Checks both the initial URL and the final URL after
 * redirects (response.url).
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.endsWith('.localhost') ||
    /^127\.\d+\.\d+\.\d+$/.test(h) || // 127.0.0.0/8 loopback
    /^10\.\d+\.\d+\.\d+$/.test(h) || // 10.0.0.0/8 private
    /^192\.168\.\d+\.\d+$/.test(h) || // 192.168.0.0/16 private
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h) || // 172.16.0.0/12 private
    /^169\.254\.\d+\.\d+$/.test(h) || // 169.254.0.0/16 link-local (cloud metadata)
    h === '::1' || // IPv6 loopback
    h === '0.0.0.0' ||
    /^f[cd]/.test(h) // IPv6 unique-local fc00::/7
  );
}

export function createWebFetchTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'web_fetch',
    description: 'Fetch and convert web content. HTML pages are converted to Markdown.',
    parameters: WebFetchSchema,
    async execute(args: z.infer<typeof WebFetchSchema>) {
      if (!args.url.startsWith('http://') && !args.url.startsWith('https://')) {
        return `Error: Invalid URL: ${args.url}`;
      }

      // SEC14: reject private/loopback/link-local hostnames before fetching
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(args.url);
      } catch {
        return `Error: Invalid URL: ${args.url}`;
      }
      if (isPrivateHost(parsedUrl.hostname)) {
        return `Error: URL resolves to a private or reserved address (SSRF protection): ${parsedUrl.hostname}`;
      }

      const timeout = 30000; // Default timeout, since ToolDeps doesn't have timeout
      const response = await fetch(args.url, { signal: AbortSignal.timeout(timeout) });

      // SEC14: after redirects, check the final URL too (302 → internal)
      try {
        const finalUrl = new URL(response.url);
        if (isPrivateHost(finalUrl.hostname)) {
          return `Error: Redirected to a private or reserved address (SSRF protection): ${finalUrl.hostname}`;
        }
      } catch {
        // malformed final URL — ignore, the response itself may still be safe
      }

      if (!response.ok) {
        return `Error: HTTP ${response.status} fetching ${args.url}`;
      }

      const contentType = response.headers.get('content-type') ?? '';
      let output: string;

      if (contentType.includes('text/html')) {
        const html = await response.text();
        output = htmlToMarkdown(html, args.url);
      } else if (contentType.includes('application/json')) {
        const json = await response.json();
        output = JSON.stringify(json, null, 2);
      } else if (contentType.startsWith('text/')) {
        output = await response.text();
      } else {
        return `Error: Unsupported content type: ${contentType}`;
      }

      const { content } = truncateOutput(output, deps.maxOutputSize);
      return content;
    },
  };
}
