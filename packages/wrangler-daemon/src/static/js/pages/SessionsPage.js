/* eslint-disable */
// ── Page: SessionsPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { ResourceList } from '../components/ResourceList.js';

// ── Page: Sessions ──
export function SessionsPage() {
  var _sSe = useState([]),
    sessions = _sSe[0],
    setSessions = _sSe[1];
  var _sWF = useState(''),
    workspaceFilter = _sWF[0],
    setWorkspaceFilter = _sWF[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];

  function loadSessions() {
    var url = '/api/sessions';
    if (workspaceFilter) url += '?workspacePath=' + encodeURIComponent(workspaceFilter);
    api.get(url).then(function (list) {
      setSessions(Array.isArray(list) ? list : []);
    }).catch(function () {
      setSessions([]);
    });
  }

  useEffect(loadSessions, []);

  function handleDelete(id) {
    if (!confirm('Delete this session?')) return;
    api.del('/api/sessions/' + id).then(function () {
      if (selected && selected.id === id) setSelected(null);
      loadSessions();
    });
  }

  function handleFork(id) {
    api.post('/api/sessions/' + id + '/fork').then(function () {
      loadSessions();
    });
  }

  function handleSelect(session) {
    api.get('/api/sessions/' + session.id).then(function (detail) {
      setSelected(detail);
    });
  }

  var columns = [
    { key: 'id', label: 'Session ID', render: function (item) {
      var short = item.id ? item.id.substring(0, 12) + '...' : '-';
      return html`
        <span
          class="name-link"
          title=${item.id}
          onClick=${function (e) {
            e.stopPropagation();
            handleSelect(item);
          }}
        >
          ${short}
        </span>
      `;
    }},
    { key: 'agentName', label: 'Agent' },
    { key: 'workspacePath', label: 'Workspace', mono: true },
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Sessions</div>
        <div class="page-desc">View and manage conversation sessions. Sessions are created automatically when you chat.</div>
      </div>

      <div class="page-toolbar">
        <div class="field" style="min-width:260px;margin-bottom:0">
          <label>Filter by Workspace</label>
          <input
            class="input"
            placeholder="Optional: /path/to/workspace"
            value=${workspaceFilter}
            onInput=${function (e) {
              setWorkspaceFilter(e.target.value);
            }}
          />
        </div>
        <button class="btn btn-secondary btn-sm" onClick=${loadSessions}>Refresh</button>
      </div>

      <${ResourceList}
        columns=${columns}
        items=${sessions}
        selectedId=${selected && selected.id}
        onSelect=${handleSelect}
        emptyMessage="No sessions found. Start a chat to create one."
        actions=${function (item) {
          return html`
            <div style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-sm" onClick=${function (e) {
                e.stopPropagation();
                handleFork(item.id);
              }}>
                Fork
              </button>
              <button class="btn btn-danger btn-sm" onClick=${function (e) {
                e.stopPropagation();
                handleDelete(item.id);
              }}>
                Delete
              </button>
            </div>
          `;
        }}
      />

      ${selected &&
      html`
        <div class="panel" style="margin-top:16px">
          <div class="panel-header">
            <span class="panel-title">${selected.id}</span>
          </div>
          <${JsonTree} data=${selected} open=${1} />
        </div>
      `}
    </div>
  `;
}
