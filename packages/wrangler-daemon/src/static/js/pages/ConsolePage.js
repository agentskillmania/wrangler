/**
 * Console —— 接口探查器。endpoints.js 里的每个 daemon 端点按组列出；
 * 选中后展示路径参数 / 查询参数 / 请求体的表单（预填示例），发送经
 * api.js 发出（因此会进 Inspector 日志）。响应原样呈现（状态码、耗时、
 * 响应体）。另有自由请求模式：任意 method+path+body。
 */
import { html, useState, useEffect } from '../utils.js';
import { api } from '../api.js';
import { ENDPOINT_GROUPS } from '../endpoints.js';
import { JsonTree } from '../components/JsonTree.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function fillPath(path, params) {
  return path.replace(/:([a-zA-Z_]+)/g, (_, name) =>
    encodeURIComponent(params[name] !== undefined ? params[name] : ':' + name)
  );
}

function buildQuery(queryValues, spec) {
  const parts = [];
  for (const q of spec || []) {
    const v = (queryValues[q.name] || '').trim();
    if (v) parts.push(`${encodeURIComponent(q.name)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function ResultPanel({ result }) {
  if (!result) return null;
  const { error, status, durationMs, data, method, path } = result;
  return html`
    <div class="panel console-result ${error ? 'is-error' : ''}">
      <div class="console-result-head">
        <span class="method m-${method}">${method}</span>
        <span class="mono">${path}</span>
        <span class="status ${!status ? 'st-net' : status >= 400 ? 'st-4xx' : 'st-2xx'}"
          >${status || 'NET'}</span
        >
        ${durationMs !== null &&
        durationMs !== undefined &&
        html`<span class="mono dim">${durationMs}ms</span>`}
      </div>
      ${error && html`<div class="error-banner">${error.message}</div>`}
      ${data !== undefined &&
      data !== null &&
      html`
        <div class="console-result-body">
          ${typeof data === 'object'
            ? html`<${JsonTree} data=${data} open=${2} />`
            : html`<pre class="mono">${String(data)}</pre>`}
        </div>
      `}
    </div>
  `;
}

export function ConsolePage() {
  const [selected, setSelected] = useState(null); // 'custom' | 端点 id
  const [paramValues, setParamValues] = useState({});
  const [queryValues, setQueryValues] = useState({});
  const [bodyText, setBodyText] = useState('');
  const [result, setResult] = useState(null);
  const [sending, setSending] = useState(false);
  // 自由请求模式的字段
  const [customMethod, setCustomMethod] = useState('GET');
  const [customPath, setCustomPath] = useState('/api/health');
  const [customBody, setCustomBody] = useState('');

  const group = ENDPOINT_GROUPS.find((g) => g.endpoints.some((e) => e.id === selected));
  const ep = group && group.endpoints.find((e) => e.id === selected);

  // 切换端点时按端点定义重置表单
  useEffect(() => {
    setResult(null);
    if (!ep) return;
    setParamValues({ ...(ep.params || {}) });
    setQueryValues({});
    if (ep.rawTextBody) setBodyText(typeof ep.body === 'string' ? ep.body : '');
    else if (ep.body !== undefined) setBodyText(JSON.stringify(ep.body, null, 2));
    else setBodyText('');
  }, [selected]);

  async function send() {
    setSending(true);
    setResult(null);
    try {
      let method,
        path,
        body,
        rawText = false;
      if (selected === 'custom') {
        method = customMethod;
        path = customPath.trim();
        body = customBody.trim() || undefined; // 自由请求的请求体原样发送
        rawText = true;
      } else if (ep) {
        method = ep.method;
        path = fillPath(ep.path, paramValues) + buildQuery(queryValues, ep.query);
        if (ep.rawTextBody) {
          body = bodyText;
          rawText = true;
        } else if (bodyText.trim()) {
          try {
            body = JSON.parse(bodyText);
          } catch (e) {
            setResult({ error: { message: '请求体不是合法 JSON：' + e.message }, method, path });
            setSending(false);
            return;
          }
        }
      } else {
        return;
      }
      const started = performance.now();
      try {
        const data = await api.raw(method, path, body, { rawText });
        setResult({
          status: 200,
          durationMs: Math.round(performance.now() - started),
          data,
          method,
          path,
        });
      } catch (e) {
        setResult({
          error: e,
          status: e.status || 0,
          durationMs: Math.round(performance.now() - started),
          data: e.body,
          method,
          path,
        });
      }
    } finally {
      setSending(false);
    }
  }

  const input = (value, setter, placeholder) => ({
    class: 'input mono',
    value: value || '',
    placeholder: placeholder || '',
    onInput: (e) => setter(e.target.value),
  });

  return html`
    <div class="page console-page">
      <div class="page-header">
        <div class="page-title">Console · 接口探查器</div>
        <div class="page-desc">
          daemon 的每个端点都能从这里直接调用，响应原样呈现；所有流量都进底部的 inspector 抽屉。
        </div>
      </div>
      <div class="console-layout">
        <div class="console-nav">
          <a
            class="console-nav-item ${selected === 'custom' ? 'active' : ''}"
            href="#"
            onClick=${(e) => {
              e.preventDefault();
              setSelected('custom');
            }}
            >⚡ 自由请求</a
          >
          ${ENDPOINT_GROUPS.map(
            (g) => html`
              <div key=${g.name} class="console-nav-group">
                <div class="console-nav-label">${g.name}</div>
                ${g.endpoints.map(
                  (e) => html`
                    <a
                      key=${e.id}
                      class="console-nav-item ${selected === e.id ? 'active' : ''}"
                      href="#"
                      onClick=${(ev) => {
                        ev.preventDefault();
                        setSelected(e.id);
                      }}
                    >
                      <span class="method m-${e.method}">${e.method}</span>
                      <span class="mono">${e.path}</span>
                    </a>
                  `
                )}
              </div>
            `
          )}
        </div>
        <div class="console-main">
          ${selected === 'custom' &&
          html`
            <div class="panel">
              <div class="panel-header"><span class="panel-title">自由请求</span></div>
              <div class="console-form">
                <select
                  class="input"
                  style="width:auto"
                  value=${customMethod}
                  onChange=${(e) => setCustomMethod(e.target.value)}
                >
                  ${METHODS.map((m) => html`<option value=${m}>${m}</option>`)}
                </select>
                <input
                  class="input mono"
                  style="flex:1"
                  value=${customPath}
                  onInput=${(e) => setCustomPath(e.target.value)}
                />
                <button class="btn btn-primary" disabled=${sending} onClick=${send}>
                  ${sending ? '…' : '发送'}
                </button>
              </div>
              <div class="field" style="margin-top:10px">
                <label>请求体（原样发送——JSON 或 YAML 文本）</label>
                <textarea
                  class="input mono"
                  rows="6"
                  value=${customBody}
                  onInput=${(e) => setCustomBody(e.target.value)}
                ></textarea>
              </div>
            </div>
          `}
          ${ep &&
          html`
            <div class="panel">
              <div class="panel-header">
                <span class="method m-${ep.method}">${ep.method}</span>
                <span class="panel-title mono">${ep.path}</span>
                ${ep.sse && html`<span class="tag tag-warn">SSE 流</span>`}
              </div>
              <div class="dim" style="margin-bottom:10px">${ep.desc}</div>
              ${ep.params &&
              Object.keys(ep.params).length > 0 &&
              html`
                <div class="console-form">
                  ${Object.keys(ep.params).map(
                    (name) => html`
                      <div key=${name} class="field" style="flex:1">
                        <label>路径参数 :${name}</label>
                        <input
                          ...${input(
                            paramValues[name],
                            (v) => setParamValues({ ...paramValues, [name]: v }),
                            ep.params[name]
                          )}
                        />
                      </div>
                    `
                  )}
                </div>
              `}
              ${ep.query &&
              ep.query.length > 0 &&
              html`
                <div class="console-form">
                  ${ep.query.map(
                    (q) => html`
                      <div key=${q.name} class="field" style="flex:1">
                        <label>查询参数 ?${q.name}${q.required ? ' *' : ''}</label>
                        <input
                          ...${input(
                            queryValues[q.name],
                            (v) => setQueryValues({ ...queryValues, [q.name]: v }),
                            q.placeholder || ''
                          )}
                        />
                      </div>
                    `
                  )}
                </div>
              `}
              ${ep.body !== undefined &&
              html`
                <div class="field">
                  <label>请求体 ${ep.rawTextBody ? '（原始 YAML 文本）' : '（JSON）'}</label>
                  <textarea
                    class="input mono"
                    rows="8"
                    value=${bodyText}
                    onInput=${(e) => setBodyText(e.target.value)}
                  ></textarea>
                </div>
              `}
              ${ep.note && html`<div class="note-banner">${ep.note}</div>`}
              <div style="margin-top:10px">
                <button class="btn btn-primary" disabled=${sending} onClick=${send}>
                  ${sending ? '发送中…' : '发送'}
                </button>
              </div>
            </div>
          `}
          ${!selected && html` <div class="panel dim">从左侧选一个端点，或用 ⚡ 自由请求。</div> `}
          <${ResultPanel} result=${result} />
        </div>
      </div>
    </div>
  `;
}

export default ConsolePage;
