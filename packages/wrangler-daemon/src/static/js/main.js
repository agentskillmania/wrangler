/* eslint-disable */
// ── Wrangler Daemon Playground Entry Point ──

import { html, render } from './utils.js';
import { App } from './App.js';

render(html`<${App} />`, document.getElementById('app'));
