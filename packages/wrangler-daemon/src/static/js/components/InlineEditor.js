/* eslint-disable */
// ── Component: InlineEditor ──
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { CodeMirrorWrapper } from '../components/CodeMirrorWrapper.js';

// ── Shared: Inline file editor for management pages ──
// Renders a file tree and textarea editor for agents/skills/crews.
export function InlineEditor(props) {
  var resourceType = props.resourceType;
  var resourceId = props.resourceId;
  var _sFT = useState([]),
    tree = _sFT[0],
    setTree = _sFT[1];
  var _sFP = useState(null),
    filePath = _sFP[0],
    setFilePath = _sFP[1];
  var _sFC = useState(''),
    fileContent = _sFC[0],
    setFileContent = _sFC[1];
  var _sSave = useState(''),
    saveStatus = _sSave[0],
    setSaveStatus = _sSave[1];

  var apiBase = '/api/' + resourceType + '/' + resourceId;

  // Load file tree when resourceId changes
  useEffect(
    function () {
      if (!resourceId) return;
      api
        .get(apiBase + '/files')
        .then(function (data) {
          setTree(Array.isArray(data) ? data : data ? [data] : []);
        })
        .catch(function () {
          setTree([]);
        });
    },
    [resourceId]
  );

  function openFile(path) {
    setFilePath(path);
    setSaveStatus('');
    api
      .get(apiBase + '/file?path=' + encodeURIComponent(path))
      .then(function (res) {
        if (typeof res === 'object' && res.content) {
          setFileContent(res.content);
        } else {
          setFileContent(typeof res === 'string' ? res : JSON.stringify(res, null, 2));
        }
      })
      .catch(function () {
        setFileContent('Error loading file.');
      });
  }

  function saveFile() {
    if (!filePath) return;
    setSaveStatus('saving...');
    api
      .put(apiBase + '/file', {
        path: filePath,
        content: fileContent,
      })
      .then(function (res) {
        if (res && res.error) {
          setSaveStatus('Error: ' + res.error);
        } else {
          setSaveStatus('Saved');
          setTimeout(function () {
            setSaveStatus('');
          }, 2000);
        }
      })
      .catch(function (e) {
        setSaveStatus('Error: ' + (e.message || 'Save failed'));
      });
  }

  function createFile() {
    var name = prompt('New file path:');
    if (!name) return;
    api.post(apiBase + '/file', { path: name, content: '' }).then(function () {
      // Reload tree
      api.get(apiBase + '/files').then(function (data) {
        setTree(Array.isArray(data) ? data : data ? [data] : []);
      });
    });
  }

  function deleteFile() {
    if (!filePath) return;
    if (!confirm('Delete "' + filePath + '"?')) return;
    api.del(apiBase + '/file', { path: filePath }).then(function () {
      setFilePath(null);
      setFileContent('');
      // Reload tree
      api.get(apiBase + '/files').then(function (data) {
        setTree(Array.isArray(data) ? data : data ? [data] : []);
      });
    });
  }

  return html`
    <div class="file-editor-section">
      <div class="detail-label">Files</div>
      <div class="editor-toolbar">
        <button class="btn btn-secondary btn-sm" onClick=${createFile}>+ New File</button>
        <button class="btn btn-danger btn-sm" disabled=${!filePath} onClick=${deleteFile}>
          Delete
        </button>
      </div>
      <div class="file-editor-layout">
        <div class="file-tree">
          <${FileTree} nodes=${tree} selectedPath=${filePath} onSelect=${openFile} />
        </div>
        <div class="editor-area">
          <div class="detail-label">${filePath || 'Select a file'}</div>
          <${CodeMirrorWrapper}
            value=${fileContent}
            onChange=${setFileContent}
            mode=${filePath && filePath.endsWith('.js') ? 'javascript' : 'markdown'}
          />
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn btn-primary btn-sm" disabled=${!filePath} onClick=${saveFile}>
              Save
            </button>
            ${saveStatus &&
            html`
              <span
                style=${'font-size:11px;color:' +
                (saveStatus.startsWith('Error')
                  ? 'var(--error)'
                  : saveStatus === 'saving...'
                    ? 'var(--warning)'
                    : 'var(--success)')}
              >
                ${saveStatus}
              </span>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}
