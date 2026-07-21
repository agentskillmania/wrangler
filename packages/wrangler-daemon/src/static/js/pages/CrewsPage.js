/* eslint-disable */
// ── Page: CrewsPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { ResourceList } from '../components/ResourceList.js';
import { DetailDrawer } from '../components/DetailDrawer.js';
import { InlineEditor } from '../components/InlineEditor.js';
import { JsonTree } from '../components/JsonTree.js';

// ── Page: Crews ──
export function CrewsPage() {
  var _sCr = useState([]),
    crews = _sCr[0],
    setCrews = _sCr[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sAg = useState([]),
    agents = _sAg[0],
    setAgents = _sAg[1];
  var _sShow = useState(false),
    showCreate = _sShow[0],
    setShowCreate = _sShow[1];
  var _sName = useState(''),
    newName = _sName[0],
    setNewName = _sName[1];
  var _sDesc = useState(''),
    newDesc = _sDesc[0],
    setNewDesc = _sDesc[1];
  var _sPA = useState(''),
    newPrimaryAgent = _sPA[0],
    setNewPrimaryAgent = _sPA[1];
  var _sInst = useState(''),
    newInstructions = _sInst[0],
    setNewInstructions = _sInst[1];
  var _sErr = useState(''),
    error = _sErr[0],
    setError = _sErr[1];

  function loadCrews() {
    api.get('/api/crews').then(function (res) {
      setCrews(Array.isArray(res) ? res : []);
    }).catch(function () {
      setCrews([]);
    });
  }

  function loadAgents() {
    api.get('/api/agents').then(function (list) {
      setAgents(Array.isArray(list) ? list : []);
    }).catch(function () {
      setAgents([]);
    });
  }

  useEffect(loadCrews, []);
  useEffect(loadAgents, []);

  function handleCreate() {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }
    api.post('/api/crews', {
      name: newName,
      description: newDesc,
      primaryAgent: newPrimaryAgent || undefined,
      instructions: newInstructions || undefined,
    }).then(function () {
      setNewName('');
      setNewDesc('');
      setNewPrimaryAgent('');
      setNewInstructions('');
      setError('');
      setShowCreate(false);
      loadCrews();
    });
  }

  function handleDelete(id) {
    if (!confirm('Delete crew "' + id + '"?')) return;
    api.del('/api/crews/' + id).then(function () {
      if (selected && selected.name === id) setSelected(null);
      loadCrews();
    });
  }

  function handleSelect(crew) {
    api.get('/api/crews/' + crew.name).then(function (detail) {
      setSelected(detail || crew);
    }).catch(function () {
      setSelected(crew);
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
    { key: 'description', label: 'Description', render: function (item) {
      return html`<span style="color:var(--text-secondary)">${item.description || '-'}</span>`;
    }},
    { key: 'agents', label: 'Agents', render: function (item) {
      var n = item.agentCount || (item.agents ? item.agents.length : 0);
      return String(n);
    }},
    { key: 'skills', label: 'Skills', render: function (item) {
      var n = item.skillCount || (item.skills ? item.skills.length : 0);
      return String(n);
    }},
    { key: 'path', label: 'Path', mono: true },
  ];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Crews</div>
        <div class="page-desc">Manage crew definitions. Each crew is a directory with a CREW.md file containing agents and skills.</div>
      </div>

      ${showCreate &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Create Crew</span></div>
          <div class="row">
            <div class="field">
              <label>Name</label>
              <input
                class="input"
                placeholder="my-crew"
                value=${newName}
                onInput=${function (e) {
                  setNewName(e.target.value);
                  setError('');
                }}
              />
              ${error && html`<div style="color:var(--error);font-size:11px;margin-top:4px">${error}</div>`}
            </div>
            <div class="field">
              <label>Primary Agent</label>
              <select
                class="input"
                value=${newPrimaryAgent}
                onChange=${function (e) { setNewPrimaryAgent(e.target.value); }}
              >
                <option value="">(none)</option>
                ${agents.map(function (a) {
                  return html`<option key=${a.id} value=${a.id}>${a.name || a.id}</option>`;
                })}
              </select>
            </div>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Description</label>
            <input
              class="input"
              placeholder="What this crew does"
              value=${newDesc}
              onInput=${function (e) { setNewDesc(e.target.value); }}
            />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Instructions</label>
            <textarea
              class="input input-mono"
              rows="3"
              placeholder="Crew-level instructions for all members."
              value=${newInstructions}
              onInput=${function (e) { setNewInstructions(e.target.value); }}
            />
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onClick=${handleCreate}>Create</button>
            <button class="btn btn-secondary btn-sm" onClick=${function () { setShowCreate(false); setError(''); }}>Cancel</button>
          </div>
        </div>
      `}

      <${ResourceList}
        columns=${columns}
        items=${crews}
        selectedId=${selected && selected.name}
        onSelect=${handleSelect}
        onCreate=${function () { setShowCreate(true); }}
        onCreateLabel="New Crew"
        emptyMessage="No crews found. Click '+ New Crew' to create one."
        actions=${function (item) {
          return html`
            <button class="btn btn-danger btn-sm" onClick=${function (e) {
              e.stopPropagation();
              handleDelete(item.name);
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
            <span class="panel-title">${selected.name}</span>
            <button class="btn btn-ghost btn-sm" onClick=${function () { setSelected(null); }}>Close</button>
          </div>
          <div class="detail-label">Details</div>
          <${JsonTree} data=${selected} open=${1} />
          <${InlineEditor}
            resourceType="crews"
            resourceId=${selected.name}
          />
        </div>
      `}
    </div>
  `;
}
