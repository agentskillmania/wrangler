/* eslint-disable */
// ── App Root Component ──
import { html, useState, useEffect } from './utils.js';
import { Sidebar } from './components/Sidebar.js';
import { ChatPage } from './pages/ChatPage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import { SkillsPage } from './pages/SkillsPage.js';
import { CrewsPage } from './pages/CrewsPage.js';
import { SessionsPage } from './pages/SessionsPage.js';
import { AgentStatePage } from './pages/AgentStatePage.js';
import { FilesPage } from './pages/FilesPage.js';
import { SpecsPage } from './pages/SpecsPage.js';
import { PlansPage } from './pages/PlansPage.js';
import { ConfigPage } from './pages/ConfigPage.js';

// ── Hash Router Utility ──
var VALID_PAGES = ['chat', 'agents', 'skills', 'crews', 'sessions', 'state', 'files', 'specs', 'plans', 'config'];

function readHashPage() {
  var h = window.location.hash.replace('#', '');
  return VALID_PAGES.indexOf(h) >= 0 ? h : 'chat';
}

// ── App Root Component ──
// Hash-based routing: page reflected in address bar, browser back/forward works.
function App() {
  var _sPg = useState(readHashPage),
    currentPage = _sPg[0],
    setCurrentPage = _sPg[1];

  // Sync hash → state on browser navigation
  useEffect(function () {
    function onHashChange() {
      setCurrentPage(readHashPage());
    }
    window.addEventListener('hashchange', onHashChange);
    return function () {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  function handleNavigate(page) {
    window.location.hash = '#' + page;
    setCurrentPage(page);
  }

  function renderPage() {
    switch (currentPage) {
      case 'chat':
        return html`<${ChatPage} />`;
      case 'agents':
        return html`<${AgentsPage} />`;
      case 'skills':
        return html`<${SkillsPage} />`;
      case 'sessions':
        return html`<${SessionsPage} />`;
      case 'state':
        return html`<${AgentStatePage} />`;
      case 'files':
        return html`<${FilesPage} />`;
      case 'crews':
        return html`<${CrewsPage} />`;
      case 'specs':
        return html`<${SpecsPage} />`;
      case 'plans':
        return html`<${PlansPage} />`;
      case 'config':
        return html`<${ConfigPage} />`;
      default:
        return html`<${ChatPage} />`;
    }
  }

  return html`
    <div class="app-layout">
      <${Sidebar} currentPage=${currentPage} onNavigate=${handleNavigate} />
      <div class="main-content">
        ${renderPage()}
      </div>
    </div>
  `;
}

export { App };
