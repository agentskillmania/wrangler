/* eslint-disable */
// ── Page: AgentStatePage（StatePage 移植，对齐 Rust c48fda0/65732f3）──
// 会话诊断驾驶舱。事件面走 GET /api/chat/:id/events（常驻流：未落盘活动
// 重放 + history-end 分界 + 直播，不随 done 关闭）；诊断快照走
// GET /api/chat/:id（一次性 JSON，done 帧到达时自动刷新）。
// 原 /api/agent/:id/state 专用 SSE 流已退役。
import { html } from '../utils.js';
import { useState } from '../utils.js';
import { useEffect } from '../utils.js';
import { useRef } from '../utils.js';
import { api } from '../api.js';
import { openEventsStream } from '../helpers/chatEventsStream.js';
import { eventToTag, formatEventData, EventCard } from './chat/EventCard.js';
import { JsonTree } from '../components/JsonTree.js';
import { SessionSelector } from '../components/SessionSelector.js';

var FIELD_LABELS = {
  status: '状态',
  'steps / messages': '步数 / 消息数',
  'tokens in/out/total': 'token 入/出/总计',
  'context est/window': '上下文 已用/窗口',
  'session id': '会话 id',
  workspace: '工作区',
  agent: 'agent',
  'runner tools': 'runner 工具数',
  'runner skills': 'runner skill 数',
  'runner features': '启用的特性',
};

function DiagnosticsOverview(props) {
  var diag = props.diag;
  if (!diag) return null;
  var overview = (diag.session && diag.session.overview) || {};
  var info = (diag.session && diag.session.info) || {};
  var runner = diag.runner || {};
  var features = runner.features || {};
  var featureNames = Object.keys(features)
    .filter(function (k) {
      return features[k];
    })
    .join(', ');
  var rows = [
    ['status', overview.status],
    [
      'steps / messages',
      (overview.stepCount != null ? overview.stepCount : '—') +
        ' / ' +
        (overview.messageCount != null ? overview.messageCount : '—'),
    ],
    [
      'tokens in/out/total',
      (overview.tokensIn != null ? overview.tokensIn : '—') +
        ' / ' +
        (overview.tokensOut != null ? overview.tokensOut : '—') +
        ' / ' +
        (overview.tokensTotal != null ? overview.tokensTotal : '—'),
    ],
    [
      'context est/window',
      (overview.estimatedContextSize != null ? overview.estimatedContextSize : '—') +
        ' / ' +
        (overview.contextWindow != null ? overview.contextWindow : '—'),
    ],
    ['session id', info.sessionId || info.id],
    ['workspace', info.workspacePath],
    ['agent', info.agentName],
    ['runner tools', (runner.tools || []).length],
    ['runner skills', (runner.skills || []).length],
    ['runner features', featureNames || '—'],
  ];
  return html`
    <div class="panel">
      <div class="panel-header"><span class="panel-title">诊断概览（GET /api/chat/:id）</span></div>
      <table class="kv-table">
        ${rows.map(function (row) {
          var v = row[1];
          return html`<tr key=${row[0]}>
            <td>${FIELD_LABELS[row[0]] || row[0]}</td>
            <td class="mono">${v === undefined || v === null || v === '' ? '—' : String(v)}</td>
          </tr>`;
        })}
      </table>
      <div style="margin-top:10px">
        <div class="dim small" style="margin-bottom:4px">完整载荷</div>
        <${JsonTree} data=${diag} open=${1} />
      </div>
    </div>
  `;
}

// ── Page: Agent State ──
export function AgentStatePage() {
  var _sSid = useState(''),
    sessionId = _sSid[0],
    setSessionId = _sSid[1];
  var _sConn = useState(false),
    connected = _sConn[0],
    setConnected = _sConn[1];
  var _sFrames = useState([]),
    frames = _sFrames[0],
    setFrames = _sFrames[1];
  var _sDiag = useState(null),
    diag = _sDiag[0],
    setDiag = _sDiag[1];
  var _sErr = useState(''),
    error = _sErr[0],
    setError = _sErr[1];
  var esRef = useRef(null);

  useEffect(function () {
    return function () {
      if (esRef.current) esRef.current.close();
    };
  }, []);

  function refreshDiag() {
    api
      .get('/api/chat/' + encodeURIComponent(sessionId.trim()))
      .then(setDiag)
      .catch(function () {
        setDiag(null);
      });
  }

  function connect() {
    disconnect();
    setFrames([]);
    setDiag(null);
    setError('');
    if (!sessionId.trim()) {
      setError('需要填会话 id');
      return;
    }
    setConnected(true);
    refreshDiag();
    esRef.current = openEventsStream(
      sessionId.trim(),
      {
        onFrame: function (frame) {
          // 上限 2000：长会话下无界数组是 O(n²) 拷贝 + 内存泄漏。
          setFrames(function (prev) {
            var next = prev.concat([
              {
                event: frame.event,
                data: frame.data,
                at: frame.at != null ? frame.at : Date.now(),
                seq: prev.length,
              },
            ]);
            return next.length > 2000 ? next.slice(next.length - 2000) : next;
          });
          if (frame.event === 'done') refreshDiag();
        },
        onError: function (e) {
          if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
          }
          setConnected(false);
          setError(e && e.message ? String(e.message) : String(e));
        },
        onTerminal: function () {
          if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
          }
          setConnected(false);
        },
      },
      { suppressReplay: false }
    );
  }

  function disconnect() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setConnected(false);
  }

  return html`
    <div class="page">
      <div class="page-header">
        <div class="page-title">State · 会话状态</div>
        <div class="page-desc">
          GET /api/chat/:id/events —— 未落盘活动重放 + history-end 分界 + 实时直播（常驻，不随 done
          关闭）；诊断快照 GET /api/chat/:id。这条流是被动的：只观察，绝不驱动 run。
        </div>
      </div>
      <div class="panel">
        <div class="row" style="margin-bottom:0">
          <div class="field">
            <label>Session</label>
            <${SessionSelector}
              value=${sessionId}
              onChange=${function (v) {
                setSessionId(v);
              }}
            />
          </div>
          <button class="btn btn-primary btn-sm" onClick=${connect} disabled=${connected}>
            连接
          </button>
          <button class="btn btn-danger btn-sm" onClick=${disconnect} disabled=${!connected}>
            断开
          </button>
        </div>
        ${error && html`<div class="error-banner">${error}</div>`}
        <div class="dim small" style="margin-top:8px">
          ${connected ? '流已打开' : '未连接'} · ${frames.length} 帧
        </div>
      </div>
      <${DiagnosticsOverview} diag=${diag} />
      ${frames.length > 0 &&
      html`
        <div class="panel">
          <div class="panel-header"><span class="panel-title">事件流</span></div>
          ${frames.map(function (f) {
            var tag = eventToTag(f.event);
            return html`<${EventCard}
              key=${f.seq}
              tag=${tag}
              text=${formatEventData(f.event, f.data)}
              id=${'state-' + f.seq}
              data=${f.data}
            />`;
          })}
        </div>
      `}
    </div>
  `;
}
