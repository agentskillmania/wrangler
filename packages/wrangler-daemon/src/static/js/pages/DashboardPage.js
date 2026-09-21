/**
 * Dashboard —— 打开 playground 的第一屏，也是唯一的"配置与环境"入口。
 * 仪表盘式网格布局：状态条 → 家底瓦片 → 四张信息卡 → 折叠区
 * （配置解析视图 / config.yaml 编辑）。全部真实呈现。
 */
import { html, useState, useEffect } from '../utils.js';
import { api } from '../api.js';
import { JsonTree } from '../components/JsonTree.js';
import { CodeEditor } from '../components/CodeEditor.js';

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtNum(n) {
  if (n === undefined || n === null) return '—';
  if (n >= 1000000) return `${Math.round(n / 100000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function CountTile({ label, count, hash, hint }) {
  return html`
    <div
      class="dash-tile"
      onClick=${() => {
        location.hash = '#' + hash;
      }}
    >
      <div class="dash-count">${count === null ? '…' : count}</div>
      <div class="dash-tile-label">${label}</div>
      ${hint && html`<div class="faint small">${hint}</div>`}
    </div>
  `;
}

/** 折叠面板：dashboard 保持一屏可读，重功能默认收起。 */
function Fold({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return html`
    <div class="panel">
      <div
        class="panel-header"
        style="margin-bottom:0;cursor:pointer"
        onClick=${() => setOpen(!open)}
      >
        <span class="panel-title">${open ? '▾' : '▸'} ${title}</span>
      </div>
      ${open && html`<div style="margin-top:10px">${children}</div>`}
    </div>
  `;
}

function Card({ title, children, moreHash, moreLabel }) {
  return html`
    <div class="panel dash-card">
      <div class="panel-header">
        <span class="panel-title">${title}</span>
        ${moreHash &&
        html`<button
          class="btn btn-sm"
          style="margin-left:auto"
          onClick=${() => {
            location.hash = '#' + moreHash;
          }}
        >
          ${moreLabel || '更多 →'}
        </button>`}
      </div>
      ${children}
    </div>
  `;
}

function LlmCard({ llm }) {
  if (!llm) return html`<div class="dim">配置加载中…</div>`;
  const providers = llm.providers || [];
  const isDefault = (name) => name === llm.defaultProvider;
  return html`
    <div class="dim small" style="margin-bottom:8px">
      默认 provider：<span class="mono" style="color:var(--accent)"
        >${llm.defaultProvider || '（未设置）'}</span
      >
      · 共 ${providers.length} 个 · 环境变量 OPENAI_API_KEY / PROVIDER / OPENAI_BASE_URL / MODEL
      可覆盖
    </div>
    ${providers.length === 0 &&
    html`<div class="note-banner">未配置任何 provider——对话与需要 LLM 的测试用例都不可用。</div>`}
    ${providers.map(
      (p) => html`
        <div key=${p.name} class="dash-provider">
          <div class="dash-provider-head">
            <span
              class="mono"
              style=${{
                fontWeight: isDefault(p.name) ? 700 : 400,
                color: isDefault(p.name) ? 'var(--accent)' : 'inherit',
              }}
              >${p.name}</span
            >
            ${isDefault(p.name) && html`<span class="tag tag-ok">默认</span>`}
            <span class="dim small mono" style="word-break:break-all"
              >${p.baseUrl || '（无 baseUrl）'}</span
            >
            <span class="dim small">key ${p.apiKey ? '已设置' : '未设置'}</span>
          </div>
          <div class="dash-models">
            <div class="dash-model-row dash-model-head">
              <span>模型</span><span>上下文</span><span>maxTokens</span><span>推理</span
              ><span>输入</span>
            </div>
            ${(p.models || []).map(
              (m) => html`
                <div key=${m.modelId} class="dash-model-row">
                  <span class="mono">${m.modelId}</span>
                  <span class="mono dim">${fmtNum(m.contextWindow)}</span>
                  <span class="mono dim">${fmtNum(m.maxTokens)}</span>
                  <span>${m.reasoning ? '✓' : '—'}</span>
                  <span class="dim">${(m.input || ['text']).join('+')}</span>
                </div>
              `
            )}
            ${(p.models || []).length === 0 &&
            html`<div class="dim small" style="padding:2px 0">（无模型）</div>`}
          </div>
        </div>
      `
    )}
  `;
}

// daemon 内置默认（wrangler/src/enhanced_runner.rs 与 build.rs 的
// unwrap_or）：config.yaml 未写这些键时的实际生效值。
const RUNNER_DEFAULTS = {
  session: true,
  todolist: true,
  commands: true,
  a2ui: false,
  specPlan: true,
  compression: true,
  thinking: false,
};

function featureOf(r, key) {
  const v = r && r[key];
  const explicit = !!(v && v.enabled !== undefined);
  return { on: explicit ? !!v.enabled : RUNNER_DEFAULTS[key], fromDefault: !explicit };
}

function RunnerCard({ config }) {
  if (!config) return html`<div class="dim">配置加载中…</div>`;
  const r = config.runner || {};
  const sandbox = config.sandbox || {};
  const search = config.search || {};
  const features = [
    'session',
    'todolist',
    'commands',
    'a2ui',
    'specPlan',
    'compression',
    'thinking',
  ].map((key) => ({ key, ...featureOf(r, key) }));
  const limits = r.limits || {};
  const limitRows = [
    ['maxSteps', limits.maxSteps],
    ['requestTimeout', limits.requestTimeout],
    ['maxInputLength', limits.maxInputLength],
    ['maxToolOutput', limits.maxToolOutput],
  ].filter(([, v]) => v !== undefined && v !== null);
  return html`
    <table class="kv-table">
      <tr>
        <td>沙箱</td>
        <td class="mono">
          ${sandbox.enabled
            ? `启用 · timeout ${sandbox.timeout ?? '—'}ms · 网络 ${sandbox.allowNetwork ? '允许' : '禁止'}`
            : '关闭'}
        </td>
      </tr>
      <tr>
        <td>搜索</td>
        <td class="mono">
          默认 ${search.defaultProvider || '（无）'} · 已配置 ${(search.providers || []).length} 个
        </td>
      </tr>
      <tr>
        <td>skillDirs</td>
        <td class="mono" style="word-break:break-all">
          ${(r.skillDirs || []).join('\n') || '（无）'}
        </td>
      </tr>
      <tr>
        <td>MCP 配置</td>
        <td class="mono" style="word-break:break-all">
          ${(r.mcpConfigPaths || []).join('\n') || '（无）'}
        </td>
      </tr>
      ${limitRows.map(
        ([k, v]) =>
          html`<tr key=${k}>
            <td>limits.${k}</td>
            <td class="mono">${String(v)}</td>
          </tr>`
      )}
    </table>
    <div class="dash-features">
      ${features.map(
        (f) => html`
          <span
            key=${f.key}
            class="tag ${f.on ? 'tag-ok' : ''} ${f.fromDefault ? 'feat-default' : ''}"
            title=${f.fromDefault
              ? 'config.yaml 未设置该键，取 daemon 内置默认'
              : 'config.yaml 显式设置'}
            >${f.on ? '●' : '○'} ${f.key}</span
          >
        `
      )}
    </div>
    <div class="faint small" style="margin-top:6px">
      ● 开 / ○ 关；淡色 = config.yaml 未写、取 daemon 默认。这是 config.yaml 层的生效值——请求级
      body.config 可逐次覆盖。
    </div>
    <div class="faint small" style="margin-top:4px">
      上表 skillDirs / MCP 的全局默认仅对 agent 会话兜底；crew
      会话完全自包含（目录私有即全部，无私有则为空）。
    </div>
  `;
}

function ConfigEditor() {
  const [raw, setRaw] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .getConfigRaw()
      .then((r) => {
        setRaw(r.content || '');
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  function saveRaw() {
    setError('');
    api
      .putConfigRaw(raw)
      .then(() => setStatus('config.yaml 已写入（只写文件；要立即生效用 PATCH）'))
      .catch((e) => setError(e.message));
  }
  function patchYaml() {
    setError('');
    setStatus('');
    api
      .patchConfigRaw(raw)
      .then(() => setStatus('PATCH 已应用——配置已重载'))
      .catch((e) => setError(e.message));
  }

  return html`
    <div class="dim small" style="margin-bottom:8px">
      注意：PATCH /api/config 的请求体是【原始 YAML 文本】（不是 JSON），会整体替换并重载；PUT
      /api/config/raw 只写文件。
    </div>
    ${loaded
      ? html`<${CodeEditor} value=${raw} onChange=${setRaw} mode="markdown" minHeight=${360} />`
      : html`<div class="dim">加载中…</div>`}
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-sm" onClick=${patchYaml}>PATCH（替换并重载）</button>
      <button class="btn btn-primary btn-sm" onClick=${saveRaw}>PUT（只写文件）</button>
    </div>
    ${status && html`<div class="success-banner">${status}</div>`}
    ${error && html`<div class="error-banner">${error}</div>`}
  `;
}

export function DashboardPage() {
  const [data, setData] = useState({});
  const [errors, setErrors] = useState([]);

  function load() {
    setErrors([]);
    const grab = (key, fn) =>
      fn()
        .then((v) => setData((d) => ({ ...d, [key]: v })))
        .catch((e) => {
          setData((d) => ({ ...d, [key]: null }));
          setErrors((prev) => [...prev, `${key}: ${e.message}`]);
        });
    grab('health', api.health);
    grab('launcher', api.launcher);
    grab('env', api.envInfo);
    grab('config', api.getConfig);
    grab('agents', api.listAgents);
    grab('skills', api.listSkills);
    grab('crews', api.listCrews);
    grab('sessions', api.listSessions);
  }
  useEffect(load, []);

  const { health, launcher, env, config, agents, skills, crews, sessions } = data;
  const llm = config && config.llm;
  const recent = (sessions || []).slice(0, 5);

  const envRows = env
    ? [
        ['应用目录', `${env.appDir}`],
        ['目录来源', env.appDirSource],
        ['配置文件', env.configPath],
        ['agents / skills', `${env.agentsDir} · ${env.skillsDir}`],
        ['crews / sessions', `${env.crewsDir} · ${env.sessionsDir}`],
        ['daemon 工作目录', env.daemonCwd],
        ['spec-plan', '工作区锚定 {workspace}/.spec-plan'],
      ]
    : [];

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">总览 Dashboard</div>
        <div class="page-desc">
          daemon 现状一屏看全——健康、配置（LLM / Runner /
          沙箱）、数据落点、家底与最近会话；配置编辑在下方折叠区。
        </div>
      </div>
      <div class="toolbar">
        <button class="btn btn-sm" onClick=${load}>刷新</button>
        ${health &&
        html`<span class="tag tag-ok">健康 ${health.status} · v${health.version}</span>`}
        ${launcher && html`<span class="tag mono">${launcher.host}:${launcher.port}</span>`}
        ${llm &&
        html`<span class="tag ${(llm.providers || []).length ? 'tag-ok' : 'tag-warn'}"
          >LLM ${(llm.providers || []).length} 个 · 默认 ${llm.defaultProvider || '无'}</span
        >`}
        <span class="spacer" />
        <button
          class="btn btn-sm"
          onClick=${() => {
            location.hash = '#e2e';
          }}
        >
          ▶ 跑自动测试
        </button>
        <button
          class="btn btn-sm"
          onClick=${() => {
            location.hash = '#runlab';
          }}
        >
          RunLab
        </button>
        <button
          class="btn btn-sm"
          onClick=${() => {
            location.hash = '#console';
          }}
        >
          Console
        </button>
      </div>
      ${errors.length > 0 && html` <div class="error-banner">${errors.join('\n')}</div> `}

      <div class="dash-stats">
        <${CountTile}
          label="Agents"
          count=${agents === undefined ? null : (agents || []).length}
          hash="agents"
          hint="平铺 .md 可见"
        />
        <${CountTile}
          label="Skills"
          count=${skills === undefined ? null : (skills || []).length}
          hash="skills"
          hint="另有运行时扫描"
        />
        <${CountTile}
          label="Crews"
          count=${crews === undefined ? null : (crews || []).length}
          hash="crews"
          hint="目录式才可对话"
        />
        <${CountTile}
          label="Sessions"
          count=${sessions === undefined ? null : (sessions || []).length}
          hash="sessions"
          hint="标准会话树"
        />
      </div>

      <div class="dash-cols">
        <div class="dash-col">
          <${Card} title="配置与数据落点 · 配置在哪、存哪">
            ${env
              ? html`
                  <table class="kv-table">
                    ${envRows.map(
                      ([k, v]) =>
                        html`<tr key=${k}>
                          <td>${k}</td>
                          <td class="mono" style="word-break:break-all">${String(v ?? '—')}</td>
                        </tr>`
                    )}
                  </table>
                  <div class="note-banner" style="margin-top:10px">
                    目录解析：<span class="mono">AGENTSKILLMANIA_APP_DIR</span>
                    环境变量优先，未设默认
                    <span class="mono">~/.agentskillmania/skill-studio</span>；gmemo 内嵌 daemon
                    指向 <span class="mono">~/.agentskillmania/gmemo/wrangler-daemon</span>。
                  </div>
                `
              : html`<div class="dim">加载中…</div>`}
          <//>
        </div>
        <div class="dash-col">
          <${Card} title="LLM 配置">
            <${LlmCard} llm=${llm} />
          <//>
        </div>
      </div>
      <div class="dash-cols">
        <div class="dash-col">
          <${Card} title="Runner 与执行环境 · 开关/沙箱/搜索/工具">
            <${RunnerCard} config=${config} />
          <//>
        </div>
        <div class="dash-col">
          <${Card} title="最近会话" moreHash="sessions" moreLabel="全部 →">
            ${sessions === undefined && html`<div class="dim">加载中…</div>`}
            ${sessions &&
            recent.length === 0 &&
            html`<div class="dim">标准会话树还没有会话（gmemo 笔记会话不在标准树里）。</div>`}
            ${recent.map(
              (s) => html`
                <div
                  key=${s.id}
                  class="e2e-step"
                  style="cursor:pointer"
                  onClick=${() => {
                    location.hash = '#state';
                  }}
                  title="去 State 页观察该会话"
                >
                  <span class="mono dim">${s.id.slice(0, 8)}…</span>
                  <span>${s.title || s.agentName || '（无标题）'}</span>
                  <span class="dim small">${fmtDate(s.updatedAt)}</span>
                </div>
              `
            )}
          <//>
        </div>
      </div>

      <div class="dash-grid">
        <${Fold} title="配置解析视图 · GET /api/config（完整 JSON）">
          ${config
            ? html`<${JsonTree} data=${config} open=${1} />`
            : html`<div class="dim">加载中…</div>`}
        <//>
        <${Fold} title="config.yaml 原文（可编辑）">
          <${ConfigEditor} />
        <//>
      </div>
    </div>
  `;
}

export default DashboardPage;
