/**
 * ResourceFilesEditor — browse / read / write / create / delete files inside
 * a resource directory (agents|skills|crews), via the /file endpoints.
 * Root = <resources>/<id>/ — for directory-form resources that's where
 * AGENT.md / CREW.md live. Binary detection is naive (UTF-8 decode check);
 * use the Files page for workspace raw/image handling.
 */
import { html, useState, useEffect } from '../utils.js';
import { api } from '../api.js';
import { FileTree } from './FileTree.js';
import { CodeEditor } from './CodeEditor.js';

export function ResourceFilesEditor({ kind, id }) {
  const [tree, setTree] = useState(null);
  const [treeError, setTreeError] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [newPath, setNewPath] = useState('');

  const filesApi = {
    agents: {
      list: api.agentFiles,
      read: api.agentFileRead,
      write: api.agentFileWrite,
      create: api.agentFileCreate,
      del: api.agentFileDelete,
    },
    skills: {
      list: api.skillFiles,
      read: api.skillFileRead,
      write: api.skillFileWrite,
      create: api.skillFileCreate,
      del: api.skillFileDelete,
    },
    crews: {
      list: api.crewFiles,
      read: api.crewFileRead,
      write: api.crewFileWrite,
      create: api.crewFileCreate,
      del: api.crewFileDelete,
    },
  }[kind];

  function loadTree() {
    setTreeError('');
    filesApi
      .list(id)
      .then((t) => setTree(t))
      .catch((e) => {
        setTree(null);
        setTreeError(e.message);
      });
  }

  useEffect(() => {
    setTree(null);
    setSelectedPath('');
    setContent('');
    setStatus('');
    setError('');
    loadTree();
  }, [kind, id]);

  function openFile(node) {
    setSelectedPath(node.path);
    setError('');
    setStatus('');
    filesApi
      .read(id, node.path)
      .then((res) => setContent(res.content))
      .catch((e) => setError(e.message));
  }

  function save() {
    if (!selectedPath) return;
    setError('');
    filesApi
      .write(id, { path: selectedPath, content })
      .then(() => setStatus(`已保存 ${selectedPath}`))
      .catch((e) => setError(e.message));
  }

  function createFile() {
    const p = newPath.trim();
    if (!p) return;
    setError('');
    filesApi
      .create(id, { path: p, content: '' })
      .then(() => {
        setNewPath('');
        setStatus(`已创建 ${p}`);
        loadTree();
        openFile({ path: p });
      })
      .catch((e) => setError(e.message));
  }

  function deleteFile() {
    if (!selectedPath) return;
    if (!confirm(`删除 ${selectedPath}？`)) return;
    setError('');
    filesApi
      .del(id, { path: selectedPath })
      .then(() => {
        setSelectedPath('');
        setContent('');
        setStatus('已删除');
        loadTree();
      })
      .catch((e) => setError(e.message));
  }

  const treeEmpty = !!(tree && (!tree.children || tree.children.length === 0));

  return html`
    <div>
      <div class="panel-header">
        <span class="panel-title">文件 · ${kind}/${id}/</span>
        <button class="btn btn-sm" onClick=${loadTree}>刷新</button>
      </div>
      ${treeError ? html`<div class="error-banner">${treeError}</div>` : null}
      ${treeEmpty
        ? html`<div class="dim small" style="margin-bottom:8px">
            目录为空——该资源没有目录式布局（只有平铺 .md），或者从未在这里创建过文件。
          </div>`
        : null}
      <div class="split-2">
        <div
          style="max-height:340px;overflow-y:auto;border:1px solid var(--border-soft);border-radius:4px;padding:4px"
        >
          <${FileTree} root=${tree} selectedPath=${selectedPath} onSelect=${openFile} />
        </div>
        <div>
          <${CodeEditor}
            key="code-editor"
            value=${content}
            onChange=${setContent}
            minHeight=${260}
          />
          <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onClick=${save} disabled=${!selectedPath}>
              保存
            </button>
            <button class="btn btn-danger btn-sm" onClick=${deleteFile} disabled=${!selectedPath}>
              删除
            </button>
            <input
              class="input mono"
              style="flex:1;min-width:140px"
              placeholder="新文件路径（如 CREW.md）"
              value=${newPath}
              onInput=${(e) => setNewPath(e.target.value)}
            />
            <button class="btn btn-sm" onClick=${createFile} disabled=${!newPath.trim()}>
              新建
            </button>
          </div>
          ${status ? html`<div class="success-banner">${status}</div>` : null}
          ${error ? html`<div class="error-banner">${error}</div>` : null}
        </div>
      </div>
    </div>
  `;
}
