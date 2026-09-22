/**
 * API helper for communicating with the wrangler-daemon backend.
 *
 * All methods return a Promise that resolves to parsed JSON or text.
 */

const BASE = location.origin;
export { BASE };

/**
 * Generic fetch wrapper with JSON/text auto-detection.
 *
 * @param {string} path - API path (e.g. /api/agents)
 * @param {RequestInit} [opts] - Fetch options
 * @returns {Promise<unknown>}
 */
function request(path, opts = {}) {
  // 旧通用路径：非抛错语义保留；挂进请求日志（Inspector/E2E 可见）。
  const entry = logStart(
    (opts && opts.method) || 'GET',
    path,
    opts && opts.body,
    'application/json'
  );
  const started = performance.now();
  return fetch(BASE + path, opts)
    .then(async function (res) {
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      logFinish(entry, {
        status: res.status,
        durationMs: Math.round(performance.now() - started),
        responseBody: data,
      });
      return data;
    })
    .catch(function (e) {
      logFinish(entry, { error: String((e && e.message) || e) });
      throw e;
    });
}

/** @type {{get:(path:string)=>Promise<unknown>, post:(path:string, body:unknown)=>Promise<unknown>, put:(path:string, body:unknown)=>Promise<unknown>, patch:(path:string, body:unknown)=>Promise<unknown>, del:(path:string, body?:unknown)=>Promise<unknown>}} */
export const api = {
  get(path) {
    return request(path);
  },

  post(path, body) {
    const opts = { method: 'POST', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return request(path, opts);
  },

  put(path, body) {
    return request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  patch(path, body) {
    return request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  del(path, body) {
    const opts = { method: 'DELETE', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return request(path, opts);
  },
};

// ═══════════════════════════════════════════════════════════════════════
// 以下为 Rust 版 api 门面移植（playground 观察页族共用：请求日志环形缓冲
// + ApiError + 具名端点面）。上方旧版通用 get/post/... 保留给既有页面
// （非抛错语义不变），同样计入请求日志。
// ═══════════════════════════════════════════════════════════════════════

// ── Global request log (ring buffer) ─────────────────────────────────────────

const LOG_CAP = 200;
/** @type {Array<object>} newest last */
export const requestLog = [];

const logListeners = new Set();
export function onRequestLogChange(fn) {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}
function notifyLog() {
  logListeners.forEach((fn) => fn());
}

let logSeq = 0;
function logStart(method, path, body, contentType) {
  const entry = {
    id: ++logSeq,
    at: new Date(),
    method,
    path,
    contentType,
    requestBody: body,
    status: null,
    durationMs: null,
    responseBody: null,
    error: null,
  };
  requestLog.push(entry);
  if (requestLog.length > LOG_CAP) requestLog.shift();
  notifyLog();
  return entry;
}
function logFinish(entry, patch) {
  Object.assign(entry, patch);
  notifyLog();
}

export class ApiError extends Error {
  constructor(message, status, body, method, path) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // number | 0 (network failure)
    this.body = body; // parsed body when available, else raw text
    this.method = method;
    this.path = path;
  }
}
/**
 * Perform a request. Body is JSON unless opts.rawText is set (then body must
 * already be a string and is sent with a YAML content type — used by
 * PATCH /api/config which takes raw YAML).
 *
 * Resolves to the parsed body (JSON when content-type says so, else text).
 * Throws ApiError on !res.ok or when the body is an {error:...} envelope.
 */
/** {error:"..."} 信封识别（HTTP 200 也可能是失败报文）。 */
function extractError(data) {
  if (data && typeof data === 'object' && typeof data.error === 'string') {
    return data;
  }
  return null;
}

export async function apiRequest(method, path, body, opts = {}) {
  const entry = logStart(method, path, body, opts.rawText ? 'text/yaml' : 'application/json');
  const started = performance.now();
  try {
    const init = { method, headers: {} };
    if (body !== undefined) {
      if (opts.rawText) {
        init.headers['Content-Type'] = 'text/yaml';
        init.body = body;
      } else {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body, null, 2);
      }
    }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    let data = text;
    if (ct.includes('json') || (!ct && text.trimStart().startsWith('{'))) {
      try {
        data = JSON.parse(text);
      } catch {
        /* keep text */
      }
    }
    const durationMs = Math.round(performance.now() - started);
    logFinish(entry, { status: res.status, durationMs, responseBody: data });

    if (!res.ok) {
      const errBody = extractError(data);
      throw new ApiError(
        (errBody && errBody.error) || `HTTP ${res.status} ${res.statusText}`,
        res.status,
        data,
        method,
        path
      );
    }
    const errBody = extractError(data);
    if (errBody) {
      // Some handlers report failures as HTTP 200 + {error:...}.
      throw new ApiError(errBody.error, res.status, data, method, path);
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    logFinish(entry, { error: String((e && e.message) || e) });
    throw new ApiError(String((e && e.message) || e), 0, null, method, path);
  }
}

/** Unwrap a list envelope: accepts `[...]`, `{key:[...]}` or `{key:...}`. */
export function unwrapList(data, key) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data[key])) return data[key];
    if (data[key] !== undefined) return [data[key]];
  }
  return [];
}

// ── Typed endpoint surface (one function per daemon endpoint) ────────────────
//（合并进上方既有 api 对象——旧通用方法与具名方法共存）
const namedApi = {
  // Health / launcher / env
  health: () => apiRequest('GET', '/api/health'),
  launcher: () => apiRequest('GET', '/api/launcher'),
  envInfo: () => apiRequest('GET', '/api/env'),

  // Models
  modelMetadata: (modelId) =>
    apiRequest('GET', `/api/models/${encodeURIComponent(modelId)}/metadata`),

  // Config
  getConfig: () => apiRequest('GET', '/api/config'),
  patchConfigRaw: (yamlText) => apiRequest('PATCH', '/api/config', yamlText, { rawText: true }),
  getConfigRaw: () => apiRequest('GET', '/api/config/raw'),
  putConfigRaw: (content) => apiRequest('PUT', '/api/config/raw', { content }),

  // Agents
  listAgents: async () => unwrapList(await apiRequest('GET', '/api/agents'), 'agents'),
  createAgent: (body) => apiRequest('POST', '/api/agents', body),
  getAgent: (id) => apiRequest('GET', `/api/agents/${encodeURIComponent(id)}`),
  deleteAgent: (id) => apiRequest('DELETE', `/api/agents/${encodeURIComponent(id)}`),
  agentFiles: (id) => apiRequest('GET', `/api/agents/${encodeURIComponent(id)}/files`),
  agentFileRead: (id, path) =>
    apiRequest(
      'GET',
      `/api/agents/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`
    ),
  agentFileWrite: (id, body) =>
    apiRequest('PUT', `/api/agents/${encodeURIComponent(id)}/file`, body),
  agentFileCreate: (id, body) =>
    apiRequest('POST', `/api/agents/${encodeURIComponent(id)}/file`, body),
  agentFileDelete: (id, body) =>
    apiRequest('DELETE', `/api/agents/${encodeURIComponent(id)}/file`, body),

  // Skills
  listSkills: async () => unwrapList(await apiRequest('GET', '/api/skills'), 'skills'),
  createSkill: (body) => apiRequest('POST', '/api/skills', body),
  getSkill: (id) => apiRequest('GET', `/api/skills/${encodeURIComponent(id)}`),
  deleteSkill: (id) => apiRequest('DELETE', `/api/skills/${encodeURIComponent(id)}`),
  availableSkills: (dirs) =>
    apiRequest('GET', '/api/skills/available' + (dirs ? `?dirs=${encodeURIComponent(dirs)}` : '')),
  skillFiles: (id) => apiRequest('GET', `/api/skills/${encodeURIComponent(id)}/files`),
  skillFileRead: (id, path) =>
    apiRequest(
      'GET',
      `/api/skills/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`
    ),
  skillFileWrite: (id, body) =>
    apiRequest('PUT', `/api/skills/${encodeURIComponent(id)}/file`, body),
  skillFileCreate: (id, body) =>
    apiRequest('POST', `/api/skills/${encodeURIComponent(id)}/file`, body),
  skillFileDelete: (id, body) =>
    apiRequest('DELETE', `/api/skills/${encodeURIComponent(id)}/file`, body),

  // Crews
  listCrews: async () => unwrapList(await apiRequest('GET', '/api/crews'), 'crews'),
  createCrew: (body) => apiRequest('POST', '/api/crews', body),
  getCrew: (id) => apiRequest('GET', `/api/crews/${encodeURIComponent(id)}`),
  deleteCrew: (id) => apiRequest('DELETE', `/api/crews/${encodeURIComponent(id)}`),
  crewFiles: (id) => apiRequest('GET', `/api/crews/${encodeURIComponent(id)}/files`),
  crewFileRead: (id, path) =>
    apiRequest('GET', `/api/crews/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`),
  crewFileWrite: (id, body) => apiRequest('PUT', `/api/crews/${encodeURIComponent(id)}/file`, body),
  crewFileCreate: (id, body) =>
    apiRequest('POST', `/api/crews/${encodeURIComponent(id)}/file`, body),
  crewFileDelete: (id, body) =>
    apiRequest('DELETE', `/api/crews/${encodeURIComponent(id)}/file`, body),

  // Sessions
  listSessions: async (workspacePath) =>
    unwrapList(
      await apiRequest(
        'GET',
        '/api/sessions' +
          (workspacePath ? `?workspacePath=${encodeURIComponent(workspacePath)}` : '')
      ),
      'sessions'
    ),
  getSession: (id) => apiRequest('GET', `/api/sessions/${encodeURIComponent(id)}`),
  deleteSession: (id) => apiRequest('DELETE', `/api/sessions/${encodeURIComponent(id)}`),
  forkSession: (id) => apiRequest('POST', `/api/sessions/${encodeURIComponent(id)}/fork`),

  // Workspace files (per session)
  fileTree: (sessionId, sessionDir) =>
    apiRequest(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/files/tree` +
        (sessionDir ? `?sessionDir=${encodeURIComponent(sessionDir)}` : '')
    ),
  fileContent: (sessionId, path, sessionDir) =>
    apiRequest(
      'GET',
      `/api/sessions/${encodeURIComponent(sessionId)}/files/content?path=${encodeURIComponent(path)}` +
        (sessionDir ? `&sessionDir=${encodeURIComponent(sessionDir)}` : '')
    ),
  fileWrite: (sessionId, body, sessionDir) =>
    apiRequest(
      'PUT',
      `/api/sessions/${encodeURIComponent(sessionId)}/files/content` +
        (sessionDir ? `?sessionDir=${encodeURIComponent(sessionDir)}` : ''),
      body
    ),
  fileCreate: (sessionId, body, sessionDir) =>
    apiRequest(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/files` +
        (sessionDir ? `?sessionDir=${encodeURIComponent(sessionDir)}` : ''),
      body
    ),
  fileDelete: (sessionId, body, sessionDir) =>
    apiRequest(
      'DELETE',
      `/api/sessions/${encodeURIComponent(sessionId)}/files` +
        (sessionDir ? `?sessionDir=${encodeURIComponent(sessionDir)}` : ''),
      body
    ),
  fileRawUrl: (sessionId, path) =>
    `${BASE}/api/sessions/${encodeURIComponent(sessionId)}/files/raw?path=${encodeURIComponent(path)}`,

  // Chat
  chatCommands: () => apiRequest('GET', '/api/chat/commands'),
  chatDiagnostics: (sessionId, sessionDir) =>
    apiRequest(
      'GET',
      `/api/chat/${encodeURIComponent(sessionId)}` +
        (sessionDir ? `?sessionDir=${encodeURIComponent(sessionDir)}` : '')
    ),
  chatMessages: (sessionId, sessionDir) =>
    apiRequest(
      'GET',
      `/api/chat/${encodeURIComponent(sessionId)}/messages` +
        (sessionDir ? `?sessionDir=${encodeURIComponent(sessionDir)}` : '')
    ),
  chatTruncate: (sessionId, body, sessionDir) =>
    apiRequest(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/truncate` +
        (sessionDir ? `?sessionDir=${encodeURIComponent(sessionDir)}` : ''),
      body
    ),
  // 停掉活跃轮与全部子任务(DELETE 409 的正路:stop it before deleting)。
  stopSession: (sessionId) => apiRequest('POST', `/api/chat/${encodeURIComponent(sessionId)}/stop`),
  // 应答挂起的 HITL 中断(ack;续跑帧在 events 流上)。
  respond: (sessionId, requestId, response) =>
    apiRequest('POST', `/api/chat/${encodeURIComponent(sessionId)}/respond`, {
      requestId,
      response,
    }),

  // Specs / Plans
  listSpecs: (workspacePath, includeArchived) =>
    apiRequest(
      'GET',
      `/api/specs?workspacePath=${encodeURIComponent(workspacePath)}` +
        (includeArchived ? '&includeArchived=true' : '')
    ),
  createSpec: (body) => apiRequest('POST', '/api/specs', body),
  getSpec: (name, version, workspacePath) =>
    apiRequest(
      'GET',
      `/api/specs/${encodeURIComponent(name)}/${encodeURIComponent(version)}?workspacePath=${encodeURIComponent(workspacePath)}`
    ),
  putSpec: (name, version, body) =>
    apiRequest(
      'PUT',
      `/api/specs/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
      body
    ),
  patchSpecStatus: (name, version, body) =>
    apiRequest(
      'PATCH',
      `/api/specs/${encodeURIComponent(name)}/${encodeURIComponent(version)}/status`,
      body
    ),
  listPlans: (workspacePath, includeArchived) =>
    apiRequest(
      'GET',
      `/api/plans?workspacePath=${encodeURIComponent(workspacePath)}` +
        (includeArchived ? '&includeArchived=true' : '')
    ),
  createPlan: (body) => apiRequest('POST', '/api/plans', body),
  getPlan: (name, specVersion, version, workspacePath) =>
    apiRequest(
      'GET',
      `/api/plans/${encodeURIComponent(name)}/${encodeURIComponent(specVersion)}/${encodeURIComponent(version)}?workspacePath=${encodeURIComponent(workspacePath)}`
    ),
  putPlan: (name, specVersion, version, body) =>
    apiRequest(
      'PUT',
      `/api/plans/${encodeURIComponent(name)}/${encodeURIComponent(specVersion)}/${encodeURIComponent(version)}`,
      body
    ),
  patchPlanStatus: (name, specVersion, version, body) =>
    apiRequest(
      'PATCH',
      `/api/plans/${encodeURIComponent(name)}/${encodeURIComponent(specVersion)}/${encodeURIComponent(version)}/status`,
      body
    ),

  // Devtool
  devtoolInit: (body) => apiRequest('POST', '/api/devtool/project/init', body),
  devtoolTemplate: (body) => apiRequest('POST', '/api/devtool/template', body),
  devtoolApply: (body) => apiRequest('POST', '/api/devtool/changes/apply', body),
  devtoolEval: (body) => apiRequest('POST', '/api/devtool/eval/run', body),

  // Raw escape hatch for the Console page.
  raw: apiRequest,
};

// 具名方法挂到既有 api 对象（旧页面 api.get(...) 与新页面 api.listAgents()
// 同一个对象；具名方法走抛错+日志的 request，旧通用方法保持非抛错）。
Object.assign(api, namedApi);
