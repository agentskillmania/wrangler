/**
 * ResourceKindPage —— Agents / Skills / Crews 的共用骨架：
 * 工具栏（刷新 + 新建）、表格、详情面板（字段 + 原始 JSON）和目录式
 * 文件编辑器。差异通过 cfg 传入。创建面板会实时显示落盘路径（来自
 * GET /api/env），让"东西存到哪"一目了然。
 */
import { html, useState, useEffect } from '../utils.js';
import { api } from '../api.js';
import { ResourceTable } from '../components/ResourceTable.js';
import { ResourceFilesEditor } from '../components/ResourceFilesEditor.js';
import { JsonTree } from '../components/JsonTree.js';

const KIND_DIR_KEY = { agents: 'agentsDir', skills: 'skillsDir', crews: 'crewsDir' };
const KIND_LABEL = { agents: 'agent', skills: 'skill', crews: 'crew' };

export function ResourceKindPage({ cfg }) {
  const {
    kind,
    title,
    desc,
    list,
    get,
    create,
    remove,
    createFields,
    renderDetail,
    notes,
    emptyMessage,
  } = cfg;

  const [items, setItems] = useState([]);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [envDir, setEnvDir] = useState(''); // 该类资源的实际存储目录

  function load() {
    setListError('');
    list()
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setListError(e.message);
      });
  }
  useEffect(load, []);

  useEffect(() => {
    api
      .envInfo()
      .then((env) => setEnvDir(env[KIND_DIR_KEY[kind]] || ''))
      .catch(() => setEnvDir(''));
  }, [kind]);

  function select(item) {
    setActionError('');
    get(item.id)
      .then(setSelected)
      .catch((e) => setActionError(e.message));
  }

  function submitCreate() {
    setFormError('');
    const name = (form.name || '').trim();
    if (!name) {
      setFormError('名字不能为空');
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      setFormError('名字不合法——daemon 只接受 ASCII 字母/数字/-/_（名字会作为文件名和路由 id）');
      return;
    }
    create(form)
      .then(() => {
        setShowCreate(false);
        setForm({});
        load();
      })
      .catch((e) => setFormError(e.message));
  }

  function removeItem(item) {
    if (!confirm(`删除 ${KIND_LABEL[kind]} "${item.id}"？（目录式布局会一并删除）`)) return;
    setActionError('');
    remove(item.id)
      .then(() => {
        if (selected && selected.id === item.id) setSelected(null);
        load();
      })
      .catch((e) => setActionError(e.message));
  }

  const typedName = (form.name || '').trim();

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">${title}</div>
        <div class="page-desc">${desc}</div>
      </div>
      ${notes && html`<div class="note-banner">${notes}</div>`}
      <div class="toolbar">
        <button class="btn btn-sm" onClick=${load}>刷新</button>
        <span class="dim small">已定义 ${items.length} 个</span>
        ${envDir && html`<span class="dim small mono">存储于 ${envDir}/</span>`}
        <span class="spacer" />
        <button class="btn btn-primary btn-sm" onClick=${() => setShowCreate(!showCreate)}>
          + 新建
        </button>
      </div>
      ${listError && html`<div class="error-banner">${listError}</div>`}
      ${showCreate &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">新建</span></div>
          ${envDir &&
          html`
            <div class="dim small" style="margin-bottom:10px">
              ${typedName && /^[A-Za-z0-9_-]+$/.test(typedName)
                ? html`将写入 <span class="mono">${envDir}/${typedName}.md</span>`
                : html`将写入 <span class="mono">${envDir}/&lt;名字&gt;.md</span>`}
            </div>
          `}
          ${createFields.map(
            (f) => html`
              <div class="field" key=${f.key}>
                <label>${f.label}${f.required ? ' *' : ''}${f.hint ? ` —— ${f.hint}` : ''}</label>
                ${f.textarea
                  ? html`<textarea
                      class="input ${f.mono ? 'mono' : ''}"
                      rows=${f.rows || 3}
                      value=${form[f.key] || ''}
                      onInput=${(e) => setForm({ ...form, [f.key]: e.target.value })}
                    ></textarea>`
                  : html`<input
                      class="input ${f.mono ? 'mono' : ''}"
                      value=${form[f.key] || ''}
                      onInput=${(e) => setForm({ ...form, [f.key]: e.target.value })}
                      placeholder=${f.placeholder || ''}
                    />`}
              </div>
            `
          )}
          ${formError && html`<div class="error-banner">${formError}</div>`}
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onClick=${submitCreate}>创建</button>
            <button
              class="btn btn-sm"
              onClick=${() => {
                setShowCreate(false);
                setFormError('');
              }}
            >
              取消
            </button>
          </div>
        </div>
      `}
      <${ResourceTable}
        columns=${[
          { key: 'id', label: 'id', render: (it) => html`<span class="name-link">${it.id}</span>` },
          { key: 'name', label: '显示名' },
          { key: 'path', label: '路径', mono: true },
        ]}
        items=${items}
        selectedId=${selected && selected.id}
        onSelect=${select}
        emptyMessage=${emptyMessage ||
        `没有${KIND_LABEL[kind]}。注意：列表接口只扫平铺的 <id>.md 文件——目录式定义在这里不可见（daemon 已知缺口）。`}
        actions=${(item) =>
          html`<button class="btn btn-danger btn-sm" onClick=${() => removeItem(item)}>
            删除
          </button>`}
      />
      ${actionError && html`<div class="error-banner">${actionError}</div>`}
      ${selected &&
      html`
        <div class="panel" style="margin-top:14px" key=${`detail-${selected.id}`}>
          <div class="panel-header">
            <span class="panel-title">${selected.id}</span>
            <span class="dim small mono">${selected.path}</span>
            <span class="spacer" style="flex:1" />
            <button class="btn btn-sm" onClick=${() => select({ id: selected.id })}>
              重新加载
            </button>
          </div>
          ${renderDetail ? renderDetail(selected) : null}
          <div class="detail-label dim small" style="margin:10px 0 4px">原始详情</div>
          <${JsonTree} data=${selected} open=${1} key="json-view" />
          <div style="margin-top:14px" key="files-editor-wrapper">
            <${ResourceFilesEditor} kind=${kind} id=${selected.id} key="files-editor" />
          </div>
        </div>
      `}
    </div>
  `;
}
