/* eslint-disable */
// ── Page: SpecsPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { ResourceList } from '../components/ResourceList.js';
import { DetailDrawer } from '../components/DetailDrawer.js';
import { InlineEditor } from '../components/InlineEditor.js';

// ── Page: Specs ──
export function SpecsPage() {
  var _sWP = useState(''),
    workspacePath = _sWP[0],
    setWorkspacePath = _sWP[1];
  var _sSp = useState([]),
    specs = _sSp[0],
    setSpecs = _sSp[1];

  function loadSpecs() {
    if (!workspacePath.trim()) {
      setSpecs([]);
      return;
    }
    api.get('/api/specs?workspacePath=' + encodeURIComponent(workspacePath)).then(function (res) {
      var list = res.specs || res || [];
      setSpecs(Array.isArray(list) ? list : []);
    }).catch(function () {
      setSpecs([]);
    });
  }

  function createSpec() {
    if (!workspacePath.trim()) {
      alert('Please enter a workspace path first.');
      return;
    }
    var name = prompt('Spec name:');
    if (!name) return;
    api.post('/api/specs', { workspacePath: workspacePath, name: name }).then(loadSpecs);
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Specs</div>
        <div class="page-desc">View and manage specification documents for your projects.</div>
      </div>

      <div class="page-toolbar">
        <div class="field" style="min-width:260px;margin-bottom:0">
          <label>Workspace Path</label>
          <input
            class="input"
            placeholder="/path/to/workspace"
            value=${workspacePath}
            onInput=${function (e) {
              setWorkspacePath(e.target.value);
            }}
          />
        </div>
        <button class="btn btn-primary btn-sm" onClick=${createSpec}>+ New Spec</button>
        <button class="btn btn-secondary btn-sm" onClick=${loadSpecs}>Refresh</button>
      </div>

      <div class="card-grid">
        ${specs.length === 0 &&
        html`
          <div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0">
            ${workspacePath ? 'No specs found.' : 'Enter a workspace path above to load specs.'}
          </div>
        `}
        ${specs.map(
          function (s) {
            var status = s.status || 'draft';
            return html`
              <div class="card" key=${s.name}>
                <h3>
                  ${s.name}
                  <span class=${'status-badge status-' + status}>${status}</span>
                </h3>
                <div class="card-meta">
                  v${s.version || 1} - ${new Date(s.updatedAt || Date.now()).toLocaleDateString()}
                </div>
              </div>
            `;
          }
        )}
      </div>
    </div>
  `;
}
