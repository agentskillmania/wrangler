/**
 * Devtool — the scaffolding endpoints the playground previously never touched:
 * project init, template materialization, changes apply (validate-all-then-
 * write, dryRun supported) and eval runs. Forms in, raw results out.
 */
import { html, useState } from '../utils.js';
import { api } from '../api.js';
import { JsonTree } from '../components/JsonTree.js';

function Result({ result, error }) {
  if (!result && !error) return null;
  return html`
    <div style="margin-top:8px">
      ${error && html`<div class="error-banner">${error}</div>`}
      ${result !== undefined && result !== null && html`<${JsonTree} data=${result} open=${2} />`}
    </div>
  `;
}

function DevtoolForm({ title, desc, fields, submitLabel, onSubmit }) {
  const [values, setValues] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return html`
    <div class="panel">
      <div class="panel-header"><span class="panel-title">${title}</span></div>
      <div class="dim small" style="margin-bottom:8px">${desc}</div>
      ${fields.map(
        (f) => html`
          <div class="field" key=${f.key}>
            <label>${f.label}${f.required ? ' *' : ''}</label>
            ${f.textarea
              ? html`<textarea
                  class="input mono"
                  rows=${f.rows || 4}
                  value=${values[f.key] || ''}
                  onInput=${(e) => setValues({ ...values, [f.key]: e.target.value })}
                ></textarea>`
              : html`<input
                  class="input ${f.mono ? 'mono' : ''}"
                  value=${values[f.key] || ''}
                  onInput=${(e) => setValues({ ...values, [f.key]: e.target.value })}
                  placeholder=${f.placeholder || ''}
                />`}
            ${f.hint && html`<div class="dim small">${f.hint}</div>`}
          </div>
        `
      )}
      <button
        class="btn btn-primary btn-sm"
        disabled=${busy}
        onClick=${() => {
          setBusy(true);
          setError('');
          setResult(null);
          Promise.resolve(onSubmit(values))
            .then((r) => setResult(r === undefined ? { ok: true } : r))
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        ${busy ? '…' : submitLabel}
      </button>
      <${Result} result=${result} error=${error} />
    </div>
  `;
}

export function DevtoolPage() {
  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">Devtool · 脚手架</div>
        <div class="page-desc">
          脚手架端点（/api/devtool/*）。建议用临时目录当 projectDir；changes/apply
          会先全量校验再落盘。
        </div>
      </div>
      <div class="split-2">
        <div>
          <${DevtoolForm}
            title="POST /api/devtool/project/init"
            desc="初始化一个 agent/crew/skill 项目目录。"
            submitLabel="初始化项目"
            fields=${[
              {
                key: 'projectDir',
                label: 'projectDir 项目目录',
                required: true,
                mono: true,
                placeholder: '/tmp/my-project',
              },
              {
                key: 'type',
                label: 'type 类型',
                required: true,
                mono: true,
                placeholder: 'agent | crew | skill',
              },
              { key: 'noGit', label: 'noGit', placeholder: 'true' },
            ]}
            onSubmit=${(v) =>
              api.devtoolInit({
                projectDir: v.projectDir?.trim(),
                type: v.type?.trim(),
                ...(v.noGit?.trim() === 'true' ? { noGit: true } : {}),
              })}
          />
          <${DevtoolForm}
            title="POST /api/devtool/template"
            desc="往项目里物化一个模板文件。"
            submitLabel="生成模板"
            fields=${[
              {
                key: 'type',
                label: 'type 类型',
                required: true,
                mono: true,
                placeholder: 'agent | skill | crew | session',
              },
              {
                key: 'name',
                label: 'name 名字',
                required: true,
                mono: true,
                placeholder: 'my-skill',
              },
              {
                key: 'projectDir',
                label: 'projectDir 项目目录',
                required: true,
                mono: true,
                placeholder: '/tmp/my-project',
              },
            ]}
            onSubmit=${(v) =>
              api.devtoolTemplate({
                type: v.type?.trim(),
                name: v.name?.trim(),
                projectDir: v.projectDir?.trim(),
              })}
          />
        </div>
        <div>
          <${DevtoolForm}
            title="POST /api/devtool/changes/apply"
            desc="应用文件变更——先全量校验再写入。dryRun 只校验不写入。"
            submitLabel="应用变更"
            fields=${[
              {
                key: 'projectDir',
                label: 'projectDir 项目目录',
                required: true,
                mono: true,
                placeholder: '/tmp/my-project',
              },
              { key: 'dryRun', label: 'dryRun', placeholder: 'true | false（默认 false）' },
              {
                key: 'changes',
                label: 'changes（JSON 数组）',
                required: true,
                textarea: true,
                rows: 6,
                placeholder: '[{"path":"docs/a.md","action":"create","content":"hello"}]',
              },
            ]}
            onSubmit=${(v) =>
              api.devtoolApply({
                projectDir: v.projectDir?.trim(),
                dryRun: v.dryRun?.trim() === 'true' ? true : undefined,
                changes: JSON.parse(v.changes),
              })}
          />
          <${DevtoolForm}
            title="POST /api/devtool/eval/run"
            desc="跑一个评测套件。"
            submitLabel="运行评测"
            fields=${[
              {
                key: 'suitePath',
                label: 'suitePath 套件路径',
                required: true,
                mono: true,
                placeholder: '/abs/suite.yaml',
              },
              { key: 'runs', label: 'runs', placeholder: '1' },
              { key: 'reporter', label: 'reporter', placeholder: 'default' },
            ]}
            onSubmit=${(v) =>
              api.devtoolEval({
                suitePath: v.suitePath?.trim(),
                ...(v.runs?.trim() ? { runs: parseInt(v.runs, 10) } : {}),
                ...(v.reporter?.trim() ? { reporter: v.reporter.trim() } : {}),
              })}
          />
        </div>
      </div>
    </div>
  `;
}

export default DevtoolPage;
