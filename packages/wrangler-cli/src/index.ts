#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { LLMClient } from '@agentskillmania/llm-client';
import { App } from './components/app.js';
import { detectMode } from './detect-mode.js';

/**
 * CLI entry point.
 *
 * Resolves the working directory, detects mode (agent / crew / bare),
 * configures the LLM client, and renders the Ink TUI.
 */
async function main() {
  const dir = process.argv[2] ?? '.';
  const model = process.env.MODEL ?? 'gpt-4';
  const apiKey = process.env.OPENAI_API_KEY ?? '';
  const baseUrl = process.env.OPENAI_BASE_URL;
  const provider = process.env.PROVIDER ?? 'openai';

  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required.');
    console.error('Set it in your .env file or environment.');
    process.exit(1);
  }

  const mode = await detectMode(dir);

  const llmClient = new LLMClient({ baseUrl });
  llmClient.registerProvider({ name: provider, maxConcurrency: 5 });
  llmClient.registerApiKey({
    key: apiKey,
    provider,
    maxConcurrency: 5,
    models: [{ modelId: model, maxConcurrency: 5 }],
  });

  render(React.createElement(App, { mode, model, llmClient }));
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
