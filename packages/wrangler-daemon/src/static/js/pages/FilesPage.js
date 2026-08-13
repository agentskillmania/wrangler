/* eslint-disable */
// ── Page: FilesPage ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { api } from '../api.js';
import { FileTree } from '../components/FileTree.js';

// ── Page: Files ──
export function FilesPage() {
  var _sSid = useState(''),
    sessionId = _sSid[0],
    setSessionId = _sSid[1];
  var _sTr = useState([]),
    tree = _sTr[0],
    setTree = _sTr[1];
  var _sFP = useState(null),
    selectedPath = _sFP[0],
    setSelectedPath = _sFP[1];
  var _sFC = useState(''),
    fileContent = _sFC[0],
    setFileContent = _sFC[1];

  function loadTree() {
    if (!sessionId.trim()) return;
    api
      .get('/api/files/' + sessionId + '/tree')
      .then(function (data) {
        setTree(Array.isArray(data) ? data : data ? [data] : []);
      })
      .catch(function () {
        setTree([]);
      });
  }

  function openFile(path) {
    setSelectedPath(path);
    api
      .get('/api/files/' + sessionId + '/content?path=' + encodeURIComponent(path))
      .then(function (res) {
        if (typeof res === 'object' && res.content) {
          setFileContent(res.content);
        } else {
          setFileContent(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
        }
      })
      .catch(function (e) {
        setFileContent('Error loading file: ' + e.message);
      });
  }

  function saveFile() {
    if (!sessionId || !selectedPath) return;
    api.put('/api/files/' + sessionId + '/content', {
      path: selectedPath,
      content: fileContent,
    });
  }

  function createFile() {
    if (!sessionId) return;
    var name = prompt('New file path:');
    if (!name) return;
    api.post('/api/files/' + sessionId, { path: name, content: '' }).then(loadTree);
  }

  function deleteFile() {
    if (!sessionId || !selectedPath) return;
    if (!confirm('Delete "' + selectedPath + '"?')) return;
    api.del('/api/files/' + sessionId, { path: selectedPath }).then(function () {
      setSelectedPath(null);
      setFileContent('');
      loadTree();
    });
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Workspace Files</div>
        <div class="page-desc">
          Browse and edit files in the agent's workspace. Requires a session ID.
        </div>
      </div>

      <div class="page-toolbar">
        <div class="field" style="min-width:300px;margin-bottom:0">
          <label>Session</label>
          <${SessionSelector}
            value=${sessionId}
            onChange=${function (v) {
              setSessionId(v);
            }}
          />
        </div>
        <button class="btn btn-secondary btn-sm" onClick=${loadTree}>Browse</button>
      </div>

      <div style="display:flex;gap:16px">
        <div style="min-width:240px;max-width:300px">
          <div class="detail-label" style="margin-bottom:8px">File Tree</div>
          <${FileTree} nodes=${tree} selectedPath=${selectedPath} onSelect=${openFile} />
        </div>
        <div style="flex:1">
          <div class="detail-label" style="margin-bottom:8px">
            ${selectedPath || 'Select a file'}
          </div>
          <textarea
            class="input input-mono"
            rows="16"
            placeholder="Select a file from the tree to view its content"
            value=${fileContent}
            onInput=${function (e) {
              setFileContent(e.target.value);
            }}
            style="min-height:300px"
          />
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary btn-sm" onClick=${saveFile}>Save</button>
            <button class="btn btn-secondary btn-sm" onClick=${createFile}>Create New</button>
            <button class="btn btn-danger btn-sm" onClick=${deleteFile}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
