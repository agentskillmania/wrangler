/* eslint-disable */
// ── Page: SpecsPage ──
import { html, useState, useEffect, useRef } from '../utils.js';
import { api } from '../api.js';
import { DetailDrawer } from '../components/DetailDrawer.js';
import { esc } from '../utils.js';

var STATUSES = ['draft', 'review', 'approved', 'rejected', 'archived'];

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
  var _sSel = useState(null),
    selected = _sSel[0],
    setSelected = _sSel[1];
  var _sDetail = useState(null),
    detail = _sDetail[0],
    setDetail = _sDetail[1];
  var _sBody = useState(''),
    bodyContent = _sBody[0],
    setBodyContent = _sBody[1];
  var _sStatus = useState(''),
    editStatus = _sStatus[0],
    setEditStatus = _sStatus[1];
  var _sSave = useState(''),
    saveStatus = _sSave[0],
    setSaveStatus = _sSave[1];
  var _sShow = useState(false),
    showCreate = _sShow[0],
    setShowCreate = _sShow[1];
  var _sNewName = useState(''),
    newName = _sNewName[0],
    setNewName = _sNewName[1];
  var _sNewBody = useState(''),
    newBody = _sNewBody[0],
    setNewBody = _sNewBody[1];
  var lastId = useRef('');

  useEffect(function () {
    api.get('/api/sessions').then(function (res) {
      var sessions = Array.isArray(res) ? res : [];
      var unique = [];
      var seen = {};
      for (var i = 0; i < sessions.length; i++) {
        var wp = sessions[i].workspacePath;
        if (wp && !seen[wp]) { seen[wp] = true; unique.push(wp); }
      }
      setWorkspaces(unique);
      if (unique.length > 0 && !workspacePath) setWorkspacePath(unique[0]);
    }).catch(function () { setWorkspaces([]); });
  }, []);

  useEffect(function () {
    if (workspacePath) loadSpecs();
  }, [workspacePath]);

  function loadSpecs() {
    if (!workspacePath.trim()) { setSpecs([]); return; }
    api.get('/api/specs?workspacePath=' + encodeURIComponent(workspacePath)).then(function (res) {
      var list = res.specs || res || [];
      setSpecs(Array.isArray(list) ? list : []);
    }).catch(function () { setSpecs([]); });
  }

  function openDetail(spec) {
    var id = spec.name + '-v' + spec.version;
    lastId.current = id;
    setSelected(spec);
    setDetail(null);
    setBodyContent('');
    setEditStatus(spec.status || 'draft');
    setSaveStatus('');
    api.get('/api/specs/' + encodeURIComponent(spec.name) + '/' + spec.version + '?workspacePath=' + encodeURIComponent(workspacePath))
      .then(function (res) {
        if (lastId.current !== id) return;
        setDetail(res);
        setBodyContent(res.body || '');
        setEditStatus(res.meta && res.meta.status ? res.meta.status : 'draft');
      }).catch(function () {
        if (lastId.current !== id) return;
        setDetail({ error: 'Failed to load detail' });
      });
  }

  function saveBody() {
    if (!selected || !workspacePath) return;
    setSaveStatus('saving...');
    api.put('/api/specs/' + encodeURIComponent(selected.name) + '/' + selected.version, {
      workspacePath: workspacePath,
      body: bodyContent,
    }).then(function (res) {
      if (res && res.error) { setSaveStatus('Error: ' + res.error); }
      else { setSaveStatus('Saved'); setTimeout(function () { setSaveStatus(''); }, 2000); }
    }).catch(function (e) {
      setSaveStatus('Error: ' + (e.message || 'Save failed'));
    });
  }

  function updateStatus() {
    if (!selected || !workspacePath) return;
    setSaveStatus('updating status...');
    api.patch('/api/specs/' + encodeURIComponent(selected.name) + '/' + selected.version + '/status', {
      workspacePath: workspacePath,
      status: editStatus,
    }).then(function (res) {
      if (res && res.error) { setSaveStatus('Error: ' + res.error); }
      else {
        setSaveStatus('Status updated');
        setTimeout(function () { setSaveStatus(''); }, 2000);
        loadSpecs();
      }
    }).catch(function (e) {
      setSaveStatus('Error: ' + (e.message || 'Update failed'));
    });
  }

  function createSpec() {
    if (!workspacePath.trim()) { alert('Please select a workspace first.'); return; }
    if (!newName.trim()) { alert('Name is required'); return; }
    api.post('/api/specs', {
      workspacePath: workspacePath,
      name: newName.trim(),
      body: newBody,
    }).then(function () {
      setNewName('');
      setNewBody('');
      setShowCreate(false);
      loadSpecs();
    }).catch(function () { alert('Create failed'); });
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
          <select class="input" value=${workspacePath} onChange=${function (e) { setWorkspacePath(e.target.value); }}>
            <option value="">Select a workspace...</option>
            ${workspaces.map(function (wp) { return html`<option key=${wp} value=${wp}>${wp}</option>`; })}
          </select>
        </div>
        <button class="btn btn-primary btn-sm" onClick=${function () { setShowCreate(true); }}>+ New Spec</button>
        <button class="btn btn-secondary btn-sm" onClick=${loadSpecs}>Refresh</button>
      </div>

      ${showCreate && html`
        <div class="panel" style="margin-bottom:16px">
          <div class="panel-header"><span class="panel-title">Create Spec</span></div>
          <div class="field" style="margin-bottom:12px">
            <label>Name</label>
            <input class="input" placeholder="my-spec" value=${newName} onInput=${function (e) { setNewName(e.target.value); }} />
          </div>
          <div class="field" style="margin-bottom:12px">
            <label>Body (markdown)</label>
            <textarea class="input input-mono" rows="6" placeholder="# Specification\n\n..." value=${newBody} onInput=${function (e) { setNewBody(e.target.value); }} />
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onClick=${createSpec}>Create</button>
            <button class="btn btn-secondary btn-sm" onClick=${function () { setShowCreate(false); }}>Cancel</button>
          </div>
        </div>
      `}

      <div class="card-grid">
        ${specs.length === 0 && html`
          <div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0">
            ${workspacePath ? 'No specs found.' : 'Select a workspace above to load specs.'}
          </div>
        `}
        ${specs.map(function (s) {
          var status = s.status || 'draft';
          return html`
            <div class="card" key=${s.name + '-v' + s.version} onClick=${function () { openDetail(s); }} style="cursor:pointer">
              <h3>
                ${s.name}
                <span class=${'status-badge status-' + status}>${status}</span>
              </h3>
              <div class="card-meta">
                v${s.version || 1} · ${new Date(s.updatedAt || Date.now()).toLocaleDateString()}
              </div>
            </div>
          `;
        })}
      </div>

      <${DetailDrawer}
        open=${selected !== null}
        title=${selected ? selected.name + ' v' + selected.version : ''}
        onClose=${function () { setSelected(null); setDetail(null); }}
      >
        ${selected && html`
          <div style="padding:8px 12px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">
            <div style="margin-bottom:4px">
              <strong>Status:</strong>
              <select
                class="input"
                style="width:auto;display:inline-block;margin-left:4px;padding:2px 6px;font-size:11px"
                value=${editStatus}
                onChange=${function (e) { setEditStatus(e.target.value); }}
              >
                ${STATUSES.map(function (st) { return html`<option value=${st}>${st}</option>`; })}
              </select>
              <button class="btn btn-secondary btn-sm" style="margin-left:8px" onClick=${updateStatus}>Update Status</button>
            </div>
            <div><strong>Created:</strong> ${selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '-'} · <strong>Updated:</strong> ${selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-'}</div>
          </div>

          <div style="padding:12px">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px">Body</div>
            ${detail === null
              ? html`<div style="color:var(--text-muted);padding:16px;text-align:center">Loading...</div>`
              : detail.error
                ? html`<div style="color:var(--error)">${esc(detail.error)}</div>`
                : html`
                  <textarea
                    class="input input-mono"
                    rows="16"
                    style="min-height:300px;width:100%"
                    value=${bodyContent}
                    onInput=${function (e) { setBodyContent(e.target.value); }}
                  />
                  <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
                    <button class="btn btn-primary btn-sm" onClick=${saveBody}>Save Body</button>
                    ${saveStatus && html`
                      <span style=${'font-size:11px;color:' + (saveStatus.startsWith('Error') ? 'var(--error)' : saveStatus === 'saving...' || saveStatus === 'updating status...' ? 'var(--warning)' : 'var(--success)')}>
                        ${saveStatus}
                      </span>
                    `}
                  </div>
                `
            }
          </div>
        `}
      <//${DetailDrawer}>
    </div>
  `;
}
