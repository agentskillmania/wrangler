/**
 * Inspector — the "feedback is real" backbone.
 *
 * Every request through api.js lands in the global requestLog. The drawer
 * (bottom of the screen, toggleable) lists them newest-first; each entry shows
 * method/path, status, duration, and the verbatim request/response bodies.
 */
import { html, useState, useEffect } from '../utils.js';
import { requestLog, onRequestLogChange } from '../api.js';
import { JsonTree } from './JsonTree.js';

function statusClass(status) {
  if (!status) return 'st-net';
  if (status >= 500) return 'st-5xx';
  if (status >= 400) return 'st-4xx';
  return 'st-2xx';
}

function fmtTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function BodyBlock({ label, value }) {
  const [open, setOpen] = useState(false);
  if (value === undefined || value === null || value === '') return null;
  const isJson = typeof value === 'object';
  return html`
    <div class="insp-body">
      <button class="insp-body-toggle" onClick=${() => setOpen(!open)}>
        ${open ? '▾' : '▸'} ${label === 'request' ? '请求体' : '响应体'}
      </button>
      ${open &&
      html`
        <div class="insp-body-content">
          ${isJson
            ? html`<${JsonTree} data=${value} open=${1} />`
            : html`<pre>${String(value)}</pre>`}
        </div>
      `}
    </div>
  `;
}

function LogEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const status = entry.status ? `${entry.status}` : entry.error ? 'NET' : '…';
  return html`
    <div class="insp-entry ${open ? 'open' : ''}">
      <div class="insp-entry-head" onClick=${() => setOpen(!open)}>
        <span class="mono dim">${fmtTime(entry.at)}</span>
        <span class="method m-${entry.method}">${entry.method}</span>
        <span class="mono insp-path">${entry.path}</span>
        <span class="status ${statusClass(entry.status)}">${status}</span>
        ${entry.durationMs !== null && html`<span class="mono dim">${entry.durationMs}ms</span>`}
        ${entry.error && html`<span class="st-5xx">${entry.error}</span>`}
      </div>
      ${open &&
      html`
        <div class="insp-entry-detail">
          <${BodyBlock} label="request" value=${entry.requestBody} />
          <${BodyBlock} label="response" value=${entry.responseBody} />
          ${entry.contentType &&
          html`<div class="dim mono small">content-type: ${entry.contentType}</div>`}
          ${entry.error &&
          !entry.status &&
          html`<div class="dim mono small">网络错误（连接失败）</div>`}
        </div>
      `}
    </div>
  `;
}

export function InspectorDrawer() {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [newest, setNewest] = useState(0);

  useEffect(() => {
    let last = 0;
    return onRequestLogChange(() => {
      const lastEntry = requestLog[requestLog.length - 1];
      const seq = lastEntry ? lastEntry.id : 0;
      if (seq > last) {
        last = seq;
        setNewest(seq);
      }
      force((n) => n + 1);
    });
  }, []);

  const entries = requestLog.slice().reverse();

  return html`
    <div class="insp-drawer ${open ? 'open' : ''}">
      <button class="insp-handle" onClick=${() => setOpen(!open)}>
        ▤ 请求记录 inspector
        <span class="insp-count">${requestLog.length}</span>
        ${!open && newest > 0 && html`<span class="insp-newest">· #${newest}</span>`}
        <span class="insp-arrow">${open ? '▾' : '▴'}</span>
      </button>
      ${open &&
      html`
        <div class="insp-list">
          ${entries.length === 0 && html`<div class="dim" style="padding:8px">还没有请求。</div>`}
          ${entries.map((e) => html`<${LogEntry} key=${e.id} entry=${e} />`)}
        </div>
      `}
    </div>
  `;
}
