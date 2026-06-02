/* eslint-disable */
// ── Page: PlansPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { ResourceList } from '../components/ResourceList.js';
import { DetailDrawer } from '../components/DetailDrawer.js';
import { InlineEditor } from '../components/InlineEditor.js';

// ── Page: Plans ──
export function PlansPage() {
  var _sWP = useState(''),
    workspacePath = _sWP[0],
    setWorkspacePath = _sWP[1];
  var _sPl = useState([]),
    plans = _sPl[0],
    setPlans = _sPl[1];

  function loadPlans() {
    if (!workspacePath.trim()) {
      setPlans([]);
      return;
    }
    api.get('/api/plans?workspacePath=' + encodeURIComponent(workspacePath)).then(function (res) {
      var list = res.plans || res || [];
      setPlans(Array.isArray(list) ? list : []);
    }).catch(function () {
      setPlans([]);
    });
  }

  function createPlan() {
    if (!workspacePath.trim()) {
      alert('Please enter a workspace path first.');
      return;
    }
    var name = prompt('Plan name:');
    if (!name) return;
    api.post('/api/plans', { workspacePath: workspacePath, name: name }).then(loadPlans);
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Plans</div>
        <div class="page-desc">View and manage execution plans for your projects.</div>
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
        <button class="btn btn-primary btn-sm" onClick=${createPlan}>+ New Plan</button>
        <button class="btn btn-secondary btn-sm" onClick=${loadPlans}>Refresh</button>
      </div>

      <div class="card-grid">
        ${plans.length === 0 &&
        html`
          <div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0">
            ${workspacePath ? 'No plans found.' : 'Enter a workspace path above to load plans.'}
          </div>
        `}
        ${plans.map(
          function (p) {
            var status = p.status || 'draft';
            return html`
              <div class="card" key=${p.name}>
                <h3>
                  ${p.name}
                  <span class=${'status-badge status-' + status}>${status}</span>
                </h3>
                <div class="card-meta">
                  v${p.version || 1} - ${new Date(p.updatedAt || Date.now()).toLocaleDateString()}
                </div>
              </div>
            `;
          }
        )}
      </div>
    </div>
  `;
}
