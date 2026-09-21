/**
 * Skills —— /api/skills 的增删查 + 目录式文件编辑器，外加"运行时可用
 * skill"对照面板（/api/skills/available）。
 */
import { html, useState } from '../utils.js';
import { api } from '../api.js';
import { ResourceKindPage } from './ResourceKindPage.js';

const cfg = {
  kind: 'skills',
  title: 'Skills',
  desc: 'skill 定义。这里只是存储；一次 run 实际能看到的 skill 来自 skillDirs 扫描——与下方"运行时可用"面板对照。',
  list: api.listSkills,
  get: api.getSkill,
  create: api.createSkill,
  remove: api.deleteSkill,
  createFields: [
    {
      key: 'name',
      label: '名字',
      required: true,
      mono: true,
      placeholder: 'my-skill',
      hint: 'ASCII 字母/数字/-/_',
    },
    { key: 'description', label: '描述', placeholder: '这个 skill 做什么' },
  ],
  renderDetail: (s) => html`
    <div>
      <div class="detail-label dim small">描述</div>
      <div>${s.description || '（空）'}</div>
      <div class="detail-label dim small" style="margin-top:8px">正文 body</div>
      <pre class="event-log" style="max-height:200px;overflow-y:auto">${s.body || '（空）'}</pre>
    </div>
  `,
};

function AvailableSkillsPanel() {
  const [dirs, setDirs] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  return html`
    <div class="panel" style="margin-top:14px">
      <div class="panel-header">
        <span class="panel-title">运行时可用 · GET /api/skills/available</span>
        <button
          class="btn btn-sm"
          onClick=${() => {
            setError('');
            api
              .availableSkills(dirs.trim() || undefined)
              .then(setResult)
              .catch((e) => {
                setResult(null);
                setError(e.message);
              });
          }}
        >
          扫描
        </button>
      </div>
      <div class="field">
        <label>?dirs=（可选，逗号分隔；留空 = agent 默认 skillDirs）</label>
        <input
          class="input mono"
          value=${dirs}
          onInput=${(e) => setDirs(e.target.value)}
          placeholder="~/.agents/skills,/绝对/目录"
        />
      </div>
      ${error && html`<div class="error-banner">${error}</div>`}
      ${result &&
      html`
        <div class="small mono">
          ${(result.skills || []).map(
            (s, i) => html`
              <div key=${i}>
                ${s.name}
                <span class="dim">—— ${(s.description || '').slice(0, 80)} [${s.source}]</span>
              </div>
            `
          )}
          ${(result.skills || []).length === 0 && html`<div class="dim">（无）</div>`}
        </div>
      `}
    </div>
  `;
}

export function SkillsPage() {
  return html`
    <div>
      <${ResourceKindPage} cfg=${cfg} />
      <${AvailableSkillsPanel} />
    </div>
  `;
}

export default SkillsPage;
