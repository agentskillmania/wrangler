/**
 * App root — hash router with lazy-loaded pages and the global Inspector
 * drawer. Nav mirrors the tool's three areas:
 *   观察 (observe) / 资源 (resources) / 工程 (engineering).
 */
import { html, useState, useEffect } from './utils.js';
import { InspectorDrawer } from './components/Inspector.js';

// page id → {label, load: dynamic import}
export const PAGES = {
  dashboard: {
    label: '总览 Dashboard',
    group: 'observe',
    load: () => import('./pages/DashboardPage.js'),
  },
  console: {
    label: 'Console 控制台',
    group: 'observe',
    load: () => import('./pages/ConsolePage.js'),
  },
  runlab: {
    label: 'RunLab 运行实验',
    group: 'observe',
    load: () => import('./pages/RunLabPage.js'),
  },
  crewlab: {
    label: 'CrewLab 协作观察',
    group: 'observe',
    load: () => import('./pages/CrewLabPage.js'),
  },
  e2e: { label: '自动测试', group: 'observe', load: () => import('./pages/E2EPage.js') },
  state: { label: 'State 状态', group: 'observe', load: () => import('./pages/StatePage.js') },
  agents: { label: 'Agents', group: 'resources', load: () => import('./pages/AgentsPage.js') },
  skills: { label: 'Skills', group: 'resources', load: () => import('./pages/SkillsPage.js') },
  crews: { label: 'Crews', group: 'resources', load: () => import('./pages/CrewsPage.js') },
  sessions: {
    label: 'Sessions 会话',
    group: 'resources',
    load: () => import('./pages/SessionsPage.js'),
  },
  files: {
    label: 'Files 工作区文件',
    group: 'resources',
    load: () => import('./pages/FilesPage.js'),
  },
  specs: { label: 'Specs 规格', group: 'engineering', load: () => import('./pages/SpecsPage.js') },
  plans: { label: 'Plans 计划', group: 'engineering', load: () => import('./pages/PlansPage.js') },
  devtool: {
    label: 'Devtool 脚手架',
    group: 'engineering',
    load: () => import('./pages/DevtoolPage.js'),
  },
  // TS 侧特有页（Rust playground 无对应——保留既有功能面）
  chat: { label: 'Chat 对话', group: 'conversation', load: () => import('./pages/ChatPage.js') },
  'crew-chat': {
    label: 'Crew Chat',
    group: 'conversation',
    load: () => import('./pages/CrewChatPage.js'),
  },
  config: {
    label: 'Config 配置',
    group: 'engineering',
    load: () => import('./pages/ConfigPage.js'),
  },
};

const NAV_GROUPS = [
  { id: 'observe', label: '观察' },
  { id: 'conversation', label: '对话' },
  { id: 'resources', label: '资源' },
  { id: 'engineering', label: '工程' },
];

function readHashPage() {
  const h = window.location.hash.replace('#', '');
  return PAGES[h] ? h : 'dashboard';
}

function LazyPage({ page }) {
  const [Comp, setComp] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    setComp(null);
    setErr(null);
    PAGES[page]
      .load()
      .then((m) => {
        if (alive) setComp(() => m.default || Object.values(m)[0]);
      })
      .catch((e) => {
        if (alive) setErr(String((e && e.message) || e));
      });
    return () => {
      alive = false;
    };
  }, [page]);
  if (err)
    return html`<div class="page"><div class="panel error-panel">页面加载失败：${err}</div></div>`;
  if (!Comp) return html`<div class="page"><div class="panel dim">加载中…</div></div>`;
  return html`<${Comp} key=${page} />`;
}

function Sidebar({ current, onNavigate }) {
  return html`
    <nav class="sidebar">
      <div class="sidebar-title">
        <div class="sidebar-name">wrangler-daemon</div>
        <div class="sidebar-sub">playground · 观察舱</div>
      </div>
      ${NAV_GROUPS.map(
        (g) => html`
          <div key=${g.id} class="nav-group">
            <div class="nav-group-label">${g.label}</div>
            ${Object.entries(PAGES)
              .filter(([, p]) => p.group === g.id)
              .map(
                ([id, p]) => html`
                  <a
                    key=${id}
                    class="nav-item ${current === id ? 'active' : ''}"
                    href="#${id}"
                    onClick=${(e) => {
                      e.preventDefault();
                      onNavigate(id);
                    }}
                    >${p.label}</a
                  >
                `
              )}
          </div>
        `
      )}
      <div class="sidebar-footer mono dim">${location.host}</div>
    </nav>
  `;
}

export function App() {
  const [current, setCurrent] = useState(readHashPage);

  useEffect(() => {
    const onHashChange = () => setCurrent(readHashPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (page) => {
    window.location.hash = '#' + page;
    setCurrent(page);
  };

  return html`
    <div class="app-layout">
      <${Sidebar} current=${current} onNavigate=${navigate} />
      <div class="main-content">
        <${LazyPage} page=${current} />
      </div>
      <${InspectorDrawer} />
    </div>
  `;
}
