import { z } from 'zod';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { Tool } from '@agentskillmania/colts';
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

export function createWebFetchTool(deps: ToolDeps): Tool<ZodTypeAny> {
  return {
    name: 'web_fetch',
    description: 'Fetch and convert web content. HTML pages are converted to Markdown.',
    parameters: WebFetchSchema,
    async execute(args: z.infer<typeof WebFetchSchema>) {
      if (!args.url.startsWith('http://') && !args.url.startsWith('https://')) {
        return `Error: Invalid URL: ${args.url}`;
      }

      const timeout = 30000; // Default timeout, since ToolDeps doesn't have timeout
      const response = await fetch(args.url, { signal: AbortSignal.timeout(timeout) });

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
