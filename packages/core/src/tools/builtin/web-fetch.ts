import { z } from 'zod';
import TurndownService from 'turndown';
import type { WranglerToolDef } from '../types.js';
import type { WorkspaceToolDeps } from './workspace-deps.js';
import { truncateOutput } from './workspace-deps.js';

const WebFetchSchema = z.object({
  url: z.string().describe('URL to fetch'),
  format: z.enum(['markdown', 'text']).optional().describe('Output format (default: markdown)'),
});

export function createWebFetchTool(
  deps: WorkspaceToolDeps
): WranglerToolDef<typeof WebFetchSchema> {
  return {
    name: 'web_fetch',
    description: 'Fetch and convert web content. HTML pages are converted to Markdown.',
    parameters: WebFetchSchema,
    async execute(args) {
      if (!args.url.startsWith('http://') && !args.url.startsWith('https://')) {
        return { output: `Error: Invalid URL: ${args.url}` };
      }

      const timeout = deps.timeout ?? 30000;
      let response: Response;
      try {
        response = await fetch(args.url, { signal: AbortSignal.timeout(timeout) });
      } catch (e) {
        return { output: `Error: Failed to fetch ${args.url}: ${(e as Error).message}` };
      }

      if (!response.ok) {
        return { output: `Error: HTTP ${response.status} fetching ${args.url}` };
      }

      const contentType = response.headers.get('content-type') ?? '';
      let output: string;

      if (contentType.includes('text/html')) {
        const html = await response.text();
        output = new TurndownService().turndown(html);
      } else if (contentType.includes('application/json')) {
        const json = await response.json();
        output = JSON.stringify(json, null, 2);
      } else if (contentType.startsWith('text/')) {
        output = await response.text();
      } else {
        return { output: `Error: Unsupported content type: ${contentType}` };
      }

      const { content, truncated } = truncateOutput(output, deps.maxOutputSize);
      return {
        output: content,
        metadata: { url: args.url, statusCode: response.status, contentType, truncated },
      };
    },
  };
}
