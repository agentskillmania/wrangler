/* eslint-disable */
// ── Page: SkillsPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { ResourceList } from '../components/ResourceList.js';
import { DetailDrawer } from '../components/DetailDrawer.js';
import { InlineEditor } from '../components/InlineEditor.js';

// ── Page: Skills ──
export function SkillsPage() {
  var _sSk = useState([]),
    skills = _sSk[0],
    setSkills = _sSk[1];
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sSC = useState(false),
    showCreate = _sSC[0],
    setShowCreate = _sSC[1];
  var _sNN = useState(''),
    newName = _sNN[0],
    setNewName = _sNN[1];
  var _sND = useState(''),
    newDesc = _sND[0],
    setNewDesc = _sND[1];
  var _sErr = useState(''),
    error = _sErr[0],
    setError = _sErr[1];

  function loadSkills() {
    api.get('/api/skills').then(function (list) {
      setSkills(Array.isArray(list) ? list : []);
    }).catch(function () {
      setSkills([]);
    });
  }

  useEffect(loadSkills, []);

  function handleCreate() {
    if (!newName.trim()) {
      setError('Name is required');
      return;
    }
    api.post('/api/skills', { name: newName, description: newDesc }).then(function () {
      setNewName('');
      setNewDesc('');
      setError('');
      setShowCreate(false);
      loadSkills();
    });
  }

  function handleDelete(id) {
    if (!confirm('Delete skill "' + id + '"?')) return;
    api.del('/api/skills/' + id).then(function () {
      if (selected && selected.id === id) setSelected(null);
      loadSkills();
    });
  }

  function handleSelect(skill) {
    api.get('/api/skills/' + skill.id).then(function (detail) {
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
        <div class="page-title">Skills</div>
        <div class="page-desc">Manage skill definitions. Each skill is a directory with a SKILL.md file.</div>
      </div>

      ${showCreate &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Create Skill</span></div>
          <div class="row">
            <div class="field">
              <label>Name</label>
              <input
                class="input"
                placeholder="my-skill"
                value=${newName}
                onInput=${function (e) {
                  setNewName(e.target.value);
                  setError('');
                }}
              />
              ${error && html`<div style="color:var(--error);font-size:11px;margin-top:4px">${error}</div>`}
            </div>
            <div class="field">
              <label>Description</label>
              <input
                class="input"
                placeholder="What this skill does"
                value=${newDesc}
                onInput=${function (e) {
                  setNewDesc(e.target.value);
                }}
              />
            </div>
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
        items=${skills}
        selectedId=${selected && selected.id}
        onSelect=${handleSelect}
        onCreate=${function () { setShowCreate(true); }}
        onCreateLabel="New Skill"
        emptyMessage="No skills found. Click '+ New Skill' to create one."
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
          <div class="detail-label">Details</div>
          <${JsonTree} data=${selected} open=${1} />
          <${InlineFileEditor}
            resourceType="skills"
            resourceId=${selected.id}
          />
        </div>
      `}
    </div>
  `;
}
