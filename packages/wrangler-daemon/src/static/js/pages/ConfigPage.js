/* eslint-disable */
// ── Page: ConfigPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { JsonTree } from '../components/JsonTree.js';

// ── Page: Config ──
export function ConfigPage() {
  var _sCfg = useState(null),
    config = _sCfg[0],
    setConfig = _sCfg[1];
  var _sPJ = useState(''),
    patchJson = _sPJ[0],
    setPatchJson = _sPJ[1];
  var _sMsg = useState(''),
    message = _sMsg[0],
    setMessage = _sMsg[1];

  function loadConfig() {
    api.get('/api/config').then(function (data) {
      setConfig(data);
    });
  }

  function applyPatch() {
    try {
      var parsed = JSON.parse(patchJson);
      api.patch('/api/config', parsed).then(function (res) {
        setConfig(res);
        setMessage('Config updated successfully.');
        setPatchJson('');
      }).catch(function (e) {
        setMessage('Error: ' + e.message);
      });
    } catch (e) {
      setMessage('Invalid JSON: ' + e.message);
    }
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Configuration</div>
        <div class="page-desc">View and update daemon configuration. Changes take effect immediately.</div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">Current Config</span>
          <button class="btn btn-secondary btn-sm" onClick=${loadConfig}>Load Config</button>
        </div>
        ${config !== null
          ? html`<${JsonTree} data=${config} open=${2} />`
          : html`<div style="color:var(--text-muted)">Click "Load Config" to view current configuration.</div>`
        }
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Patch Config</span></div>
        <div class="field" style="margin-bottom:12px">
          <label>JSON</label>
          <textarea
            class="input input-mono"
            rows="3"
            placeholder='{"llm":{"model":"gpt-4"}}'
            value=${patchJson}
            onInput=${function (e) {
              setPatchJson(e.target.value);
              setMessage('');
            }}
          />
        </div>
        <button class="btn btn-primary btn-sm" onClick=${applyPatch}>Apply</button>
        ${message &&
        html`
          <div style="margin-top:8px;font-size:12px;color=${message.startsWith('Error') ? 'var(--error)' : 'var(--success)'}">
            ${message}
          </div>
        `}
      </div>
    </div>
  `;
}
