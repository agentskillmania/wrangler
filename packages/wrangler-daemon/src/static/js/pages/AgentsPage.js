/**
 * Agents —— /api/agents 的增删查 + 目录式文件编辑器。
 * 两种布局：平铺 <agents>/<id>.md（"新建"写的就是它）与目录式
 * <agents>/<id>/AGENT.md（下方编辑器管理）。daemon 都认；列表只显平铺
 * （后端缺口）。
 */
import { html } from '../utils.js';
import { api } from '../api.js';
import { ResourceKindPage } from './ResourceKindPage.js';

const cfg = {
  kind: 'agents',
  title: 'Agents',
  desc: 'agent 定义——instructions、可选 model、可选目录式文件（AGENT.md / skills / mcp.json）。',
  list: api.listAgents,
  get: api.getAgent,
  create: api.createAgent,
  remove: api.deleteAgent,
  createFields: [
    {
      key: 'name',
      label: '名字',
      required: true,
      mono: true,
      placeholder: 'my-agent',
      hint: 'ASCII 字母/数字/-/_',
    },
    {
      key: 'instructions',
      label: 'instructions（指令）',
      textarea: true,
      rows: 4,
      placeholder: 'You are a helpful assistant.',
    },
  ],
  renderDetail: (a) => html`
    <div>
      <div class="detail-label dim small">instructions</div>
      <pre class="event-log" style="max-height:200px;overflow-y:auto">
${a.instructions || '（空）'}</pre
      >
      ${a.model && html`<div class="dim small mono">模型：${a.model}</div>`}
    </div>
  `,
};

export function AgentsPage() {
  return html`<${ResourceKindPage} cfg=${cfg} />`;
}

export default AgentsPage;
