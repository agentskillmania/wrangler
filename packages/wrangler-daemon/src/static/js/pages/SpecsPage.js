/* eslint-disable */
// ── Page: SpecsPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';

// ── Page: Specs ──
export function SpecsPage() {
  var _sWorkspaces = useState([]),
    workspaces = _sWorkspaces[0],
    setWorkspaces = _sWorkspaces[1];
  var _sWP = useState(''),
    workspacePath = _sWP[0],
    setWorkspacePath = _sWP[1];
  var _sSp = useState([]),
    specs = _sSp[0],
    setSpecs = _sSp[1];

  // Load all workspaces from sessions
  useEffect(function () {
    api.get('/api/sessions').then(function (res) {
      var sessions = Array.isArray(res) ? res : [];
      var uniqueWorkspaces = [];
      var seen = {};
      for (var i = 0; i < sessions.length; i++) {
        var wp = sessions[i].workspacePath;
        if (wp && !seen[wp]) {
          seen[wp] = true;
          uniqueWorkspaces.push(wp);
        }
      }
      setWorkspaces(uniqueWorkspaces);
      // Auto-select first workspace if none selected
      if (uniqueWorkspaces.length > 0 && !workspacePath) {
        setWorkspacePath(uniqueWorkspaces[0]);
      }
    }).catch(function () {
      setWorkspaces([]);
    });
  }, []);

  // Load specs when workspace changes
  useEffect(function () {
    if (workspacePath) {
      loadSpecs();
    }
  }, [workspacePath]);

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
      alert('Please select a workspace first.');
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
        <div class="field" style="min-width:300px;margin-bottom:0">
          <label>Workspace</label>
          <select
            class="input"
            value=${workspacePath}
            onChange=${function (e) {
              setWorkspacePath(e.target.value);
            }}
          >
            <option value="">Select a workspace...</option>
            ${workspaces.map(function (wp) {
              return html`<option key=${wp} value=${wp}>${wp}</option>`;
            })}
          </select>
        </div>
        <button class="btn btn-primary btn-sm" onClick=${createSpec}>+ New Spec</button>
        <button class="btn btn-secondary btn-sm" onClick=${loadSpecs}>Refresh</button>
      </div>

      <div class="card-grid">
        ${specs.length === 0 &&
        html`
          <div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0">
            ${workspacePath ? 'No specs found.' : 'Select a workspace above to load specs.'}
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
