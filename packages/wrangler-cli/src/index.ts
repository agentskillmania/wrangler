#!/usr/bin/env node
/**
 * wrangler CLI entry — load config, detect mode, render TUI
 *
 * Adapted from colts-cli's index.ts pattern:
 * loadConfig() → detectMode() → render(App)
 */

import React from 'react';
import { render } from 'ink';
import { App } from './components/app.js';
import { detectMode } from './detect-mode.js';
import { loadConfig } from './config.js';

async function main() {
  const dir = process.argv[2] ?? '.';

  const [config, mode] = await Promise.all([loadConfig(), detectMode(dir)]);

  render(React.createElement(App, { config, mode, dir }));
}

main().catch((err: unknown) => {
  console.error('Failed to start wrangler:', err);
  process.exit(1);
});
