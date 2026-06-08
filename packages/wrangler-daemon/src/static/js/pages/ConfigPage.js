/* eslint-disable */
// ── Page: ConfigPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { JsonTree } from '../components/JsonTree.js';

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

  // Config file state
  var _sFilePath = useState(''),
    filePath = _sFilePath[0],
    setFilePath = _sFilePath[1];
  var _sFileContent = useState(''),
    fileContent = _sFileContent[0],
    setFileContent = _sFileContent[1];
  var _sFileMsg = useState(''),
    fileMessage = _sFileMsg[0],
    setFileMessage = _sFileMsg[1];

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

  function loadFile() {
    if (!filePath.trim()) { setFileMessage('Path is required'); return; }
    setFileMessage('loading...');
    api.get('/api/config/file?path=' + encodeURIComponent(filePath.trim())).then(function (res) {
      if (res && res.error) { setFileMessage('Error: ' + res.error); }
      else {
        setFileContent(typeof res.content === 'string' ? res.content : JSON.stringify(res.content, null, 2));
        setFileMessage('Loaded');
        setTimeout(function () { setFileMessage(''); }, 2000);
      }
    }).catch(function (e) {
      setFileMessage('Error: ' + (e.message || 'Load failed'));
    });
  }

  function saveFile() {
    if (!filePath.trim()) { setFileMessage('Path is required'); return; }
    setFileMessage('saving...');
    api.put('/api/config/file', { path: filePath.trim(), content: fileContent }).then(function (res) {
      if (res && res.error) { setFileMessage('Error: ' + res.error); }
      else { setFileMessage('Saved'); setTimeout(function () { setFileMessage(''); }, 2000); }
    }).catch(function (e) {
      setFileMessage('Error: ' + (e.message || 'Save failed'));
    });
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Configuration</div>
        <div class="page-desc">View and update daemon configuration and config files.</div>
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
        ${message && html`
          <div style="margin-top:8px;font-size:12px;color=${message.startsWith('Error') ? 'var(--error)' : 'var(--success)'}">
            ${message}
          </div>
        `}
      </div>

      <div class="panel">
        <div class="panel-header"><span class="panel-title">Config Files</span></div>
        <div class="field" style="margin-bottom:12px">
          <label>File Path</label>
          <input
            class="input input-mono"
            placeholder="e.g. ~/.agentskillmania/skill-studio/config.yaml"
            value=${filePath}
            onInput=${function (e) {
              setFilePath(e.target.value);
              setFileMessage('');
            }}
          />
        </div>
        <div class="field" style="margin-bottom:12px">
          <label>Content</label>
          <textarea
            class="input input-mono"
            rows="12"
            placeholder="Click Load to read file content..."
            value=${fileContent}
            onInput=${function (e) {
              setFileContent(e.target.value);
              setFileMessage('');
            }}
          />
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-secondary btn-sm" onClick=${loadFile}>Load</button>
          <button class="btn btn-primary btn-sm" onClick=${saveFile}>Save</button>
          ${fileMessage && html`
            <span style=${'font-size:11px;color:' + (fileMessage.startsWith('Error') ? 'var(--error)' : fileMessage === 'loading...' || fileMessage === 'saving...' ? 'var(--warning)' : 'var(--success)')}>
              ${fileMessage}
            </span>
          `}
        </div>
      </div>
    </div>
  `;
}
