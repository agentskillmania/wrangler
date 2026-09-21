/**
 * Crews —— /api/crews 的增删查 + 目录内文件编辑器。
 * CRUD 与 chat 同源：创建直接写 <crews>/<id>/CREW.md（YAML frontmatter
 * + 正文），与 CrewLoader 读取的布局一致——建出来就能对话。
 */
import { html } from '../utils.js';
import { api } from '../api.js';
import { ResourceKindPage } from './ResourceKindPage.js';

const cfg = {
  kind: 'crews',
  title: 'Crews',
  desc: 'crew 定义。创建即写目录布局（<id>/CREW.md），与 chat 同源。目录即全世界（三件套自包含）：agents/ 即成员（primary-agent 也在其中寻址，无全局回落）；skills/ 即技能（不落全局 skillDirs）；mcp.json 即 MCP 声明（不落全局）。',
  list: api.listCrews,
  get: api.getCrew,
  create: api.createCrew,
  remove: api.deleteCrew,
  emptyMessage: '还没有 crew。点"+ 新建"创建——建出来即可在 RunLab 里对话。',
  createFields: [
    {
      key: 'name',
      label: '名字',
      required: true,
      mono: true,
      placeholder: 'my-crew',
      hint: 'ASCII 字母/数字/-/_',
    },
    {
      key: 'primaryAgent',
      label: 'primary-agent（主 agent）',
      required: true,
      mono: true,
      placeholder: 'coordinator',
      hint: '只在本 crew 的 agents/<同名>.md 里寻址，无全局回落——填全局 agent 名仅借用名字，不会加载其 instructions',
    },
    { key: 'description', label: '描述', placeholder: '这个 crew 做什么' },
    {
      key: 'body',
      label: '正文（crew 任务描述）',
      textarea: true,
      rows: 3,
      placeholder: '描述这个 crew 如何协调。',
    },
  ],
  renderDetail: (c) => html`
    <div>
      <table class="kv-table" style="margin-bottom:8px">
        <tr>
          <td>primary-agent</td>
          <td class="mono">${c.primaryAgent}</td>
        </tr>
        <tr>
          <td>描述</td>
          <td>${c.description || '（空）'}</td>
        </tr>
        <tr>
          <td>私有 agents</td>
          <td class="mono">${(c.agents || []).join('、') || '（无）'}</td>
        </tr>
        <tr>
          <td>私有 skills</td>
          <td class="mono">${(c.skills || []).join('、') || '（无）'}</td>
        </tr>
      </table>
      <div class="detail-label dim small">正文（CREW.md body）</div>
      <pre class="event-log" style="max-height:200px;overflow-y:auto">${c.body || '（空）'}</pre>
    </div>
  `,
};

export function CrewsPage() {
  return html`<${ResourceKindPage} cfg=${cfg} />`;
}

export default CrewsPage;
