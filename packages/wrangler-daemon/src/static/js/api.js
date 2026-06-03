/**
 * API helper for communicating with the wrangler-daemon backend.
 *
 * All methods return a Promise that resolves to parsed JSON or text.
 */

const BASE = location.origin;

/**
 * Generic fetch wrapper with JSON/text auto-detection.
 *
 * @param {string} path - API path (e.g. /api/agents)
 * @param {RequestInit} [opts] - Fetch options
 * @returns {Promise<unknown>}
 */
function request(path, opts = {}) {
  return fetch(BASE + path, opts).then(function (res) {
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
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
