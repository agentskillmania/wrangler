/* eslint-disable */
// ── Page: AgentsPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { ResourceList } from '../components/ResourceList.js';
import { DetailDrawer } from '../components/DetailDrawer.js';
import { InlineEditor } from '../components/InlineEditor.js';

// ── Page: Agents ──
export function AgentsPage() {
  var _sAg = useState([]),
    agents = _sAg[0],
    setAgents = _sAg[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sSC = useState(false),
    showCreate = _sSC[0],
    setShowCreate = _sSC[1];
  var _sNN = useState(''),
    newName = _sNN[0],
    setNewName = _sNN[1];
  var _sNI = useState(''),
    newInstructions = _sNI[0],
    setNewInstructions = _sNI[1];
  var _sErr = useState(''),
    error = _sErr[0],
    setError = _sErr[1];

  function loadAgents() {
    api.get('/api/agents').then(function (list) {
      setAgents(Array.isArray(list) ? list : []);
    }).catch(function () {
      setAgents([]);
    });
  }

  useEffect(loadAgents, []);

  function handleCreate() {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }
    api.post('/api/agents', { name: newName, instructions: newInstructions }).then(function () {
      setNewName('');
      setNewInstructions('');
      setError('');
      setShowCreate(false);
      loadAgents();
    });
  }

  function handleDelete(id) {
    if (!confirm('Delete agent "' + id + '"?')) return;
    api.del('/api/agents/' + id).then(function () {
      if (selected && selected.id === id) setSelected(null);
      loadAgents();
    });
  }

  function handleSelect(agent) {
    api.get('/api/agents/' + agent.id).then(function (detail) {
      setSelected(detail);
    });
  }

  var columns = [
    { key: 'name', label: 'Name', render: function (item) {
      return html`
        <span
          class="name-link"
          onClick=${function (e) {
            e.stopPropagation();
            handleSelect(item);
          }}
        >
          ${item.name || item.id}
        </span>
      `;
    }},
    { key: 'path', label: 'Path', mono: true },
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Agents</div>
        <div class="page-desc">Manage agent definitions. Each agent is a directory with an AGENT.md file.</div>
      </div>

      ${showCreate &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Create Agent</span></div>
          <div class="field" style="margin-bottom:12px">
            <label>Name</label>
            <input
              class="input"
              placeholder="my-agent"
              value=${newName}
              onInput=${function (e) {
                setNewName(e.target.value);
                setError('');
              }}
            />
            ${error && html`<div style="color:var(--error);font-size:11px;margin-top:4px">${error}</div>`}
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Instructions</label>
            <textarea
              class="input input-mono"
              rows="3"
              placeholder="You are a helpful assistant."
              value=${newInstructions}
              onInput=${function (e) {
                setNewInstructions(e.target.value);
              }}
            />
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onClick=${handleCreate}>Create</button>
            <button class="btn btn-secondary btn-sm" onClick=${function () { setShowCreate(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </div>
      `}

      <${ResourceList}
        columns=${columns}
        items=${agents}
        selectedId=${selected && selected.id}
        onSelect=${handleSelect}
        onCreate=${function () { setShowCreate(true); }}
        onCreateLabel="New Agent"
        emptyMessage="No agents found. Click '+ New Agent' to create one."
        actions=${function (item) {
          return html`
            <button class="btn btn-danger btn-sm" onClick=${function (e) {
              e.stopPropagation();
              handleDelete(item.id);
            }}>
              Delete
            </button>
          `;
        }}
      />

      ${selected &&
      html`
        <div class="panel" style="margin-top:16px">
          <div class="panel-header">
            <span class="panel-title">${selected.name || selected.id}</span>
          </div>
          <div class="detail-label">Instructions</div>
          <div class="event-log" style="max-height:200px;margin-bottom:12px">
            ${selected.instructions || '(no instructions)'}
          </div>
          <div class="detail-label">JSON</div>
          <${JsonTree} data=${selected} open=${1} />
          <${InlineFileEditor}
            resourceType="agents"
            resourceId=${selected.id}
          />
        </div>
      `}
    </div>
  `;
}
