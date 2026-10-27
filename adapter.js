/* adapter.js 【鎖定檔，禁止修改】
 * 職責：session 儲存、ID token 更新、Firebase Auth REST、RTDB REST 封裝。
 * 抽換點（Azure）：另寫一份提供相同 API 的 adapter，並在 config.js 的 scripts 以新檔名取代 adapter.js。
 *   介面：cfg / session() / setSession(s) / clearSession() / getToken(force) / identity(op, body)
 *        rtdb(method, path, body, opts) / streamUrl(path, token) / bindMember(key) / jwt(token) / p(...segments)
 *        emailKey(email) / data{ newId, list, save, remove, checkKey, toObj }
 *   目前僅保留此介面，未提供 Azure 實作。
 */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG;
  const API_KEY = atob(cfg.apiKey64);
  const SKEY = 'mws:' + cfg.projectId + ':session';
  const DB = cfg.databaseURL.replace(/\/+$/, '');

  // kind: network（連不上）| auth（需重新登入）| denied（rules 拒絕：權限不足或已被撤銷）| http（其他）
  class AdapterError extends Error {
    constructor(kind, message, status, code) {
      super(message);
      this.name = 'AdapterError';
      this.kind = kind;
      this.status = status;
      this.code = code;
    }
  }

  let sess = null;
  try { sess = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { sess = null; }
  let refreshing = null;

  const persist = () => localStorage.setItem(SKEY, JSON.stringify(sess));
  const session = () => sess;
  const clearSession = () => { sess = null; localStorage.removeItem(SKEY); };

  function setSession(s) {
    sess = {
      uid: s.uid,
      idToken: s.idToken,
      refreshToken: s.refreshToken,
      expiresAt: s.expiresAt || Date.now() + Number(s.expiresIn || 3600) * 1000,
      email: s.email || null
    };
    persist();
    return sess;
  }

  // 每個路徑片段都必須編碼，避免 token / email key 破壞 URL
  const p = (...segs) => '/' + segs.map(encodeURIComponent).join('/');

  function jwt(token) {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  }

  async function refreshNow() {
    let res;
    try {
      res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.refreshToken)
      });
    } catch (e) {
      throw new AdapterError('network', '網路無法連線');
    }
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        clearSession();
        throw new AdapterError('auth', '登入已失效，請重新登入', res.status);
      }
      throw new AdapterError('http', '更新登入狀態失敗 (' + res.status + ')', res.status);
    }
    const d = await res.json();
    sess = Object.assign({}, sess, {
      uid: d.user_id,
      idToken: d.id_token,
      refreshToken: d.refresh_token,
      expiresAt: Date.now() + Number(d.expires_in) * 1000
    });
    persist();
    return sess.idToken;
  }

  async function getToken(force) {
    if (!sess) throw new AdapterError('auth', '尚未登入');
    if (!force && sess.idToken && Date.now() < sess.expiresAt - 60000) return sess.idToken;
    if (!refreshing) refreshing = refreshNow().finally(() => { refreshing = null; });
    return refreshing;
  }

  // Firebase Auth REST（identitytoolkit），op 例如 'accounts:signUp'
  async function identity(op, body) {
    let res;
    try {
      res = await fetch('https://identitytoolkit.googleapis.com/v1/' + op + '?key=' + API_KEY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new AdapterError('network', '網路無法連線');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const raw = (data.error && data.error.message) || 'HTTP ' + res.status;
      throw new AdapterError('http', raw, res.status, String(raw).split(/[\s:]/)[0]);
    }
    return data;
  }

  // RTDB REST。有 session 就帶 auth；401 先判斷是否為 rules 拒絕，否則強制更新 token 後重試一次。
  async function rtdb(method, path, body, opts) {
    opts = opts || {};
    const anon = !!opts.anon || !sess;
    for (let attempt = 0; attempt < 2; attempt++) {
      const q = [];
      if (!anon) q.push('auth=' + encodeURIComponent(await getToken(attempt > 0)));
      if (opts.query) q.push(opts.query);
      const url = DB + path + '.json' + (q.length ? '?' + q.join('&') : '');
      let res;
      try {
        res = await fetch(url, {
          method: method,
          cache: 'no-store',
          headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      } catch (e) {
        throw new AdapterError('network', '網路無法連線');
      }
      if (res.ok) return res.json();
      const err = await res.json().catch(() => ({}));
      const msg = (err && err.error) || 'HTTP ' + res.status;
      if (res.status === 403 || (res.status === 401 && /permission denied/i.test(msg))) {
        throw new AdapterError('denied', '沒有權限（角色不足或存取已被撤銷）', res.status);
      }
      if (res.status === 401 && !anon && attempt === 0) continue;
      if (res.status === 401) throw new AdapterError(anon ? 'denied' : 'auth', '沒有權限或登入已失效', 401);
      throw new AdapterError('http', String(msg), res.status);
    }
  }

  function streamUrl(path, token) {
    return DB + path + '.json' + (token ? '?auth=' + encodeURIComponent(token) : '');
  }

  // 把目前 uid 綁定到名冊項目；名冊不存在或已停用回傳 null
  async function bindMember(key) {
    const entry = await rtdb('GET', p('roster', key));
    if (!entry || entry.active !== true) return null;
    await rtdb('PUT', p('members', sess.uid), { key: key });
    return entry;
  }

  // email → RTDB key（小寫、'.' 換成 ','）。必須與 rules 內的 toLowerCase().replace('.', ',') 一致；
  // 含 ',' 的 email 一律拒絕，避免兩個不同 email 對應到同一個 key。
  function emailKey(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e) || /[$#\[\]\/]/.test(e)) return null;
    return e.replace(/\./g, ',');
  }

  // 資料層：/data/<collection>/<id>。Sync 模組只負責「變更如何送達」，CRUD 一律在這裡。
  const KEY_RE = /^[^.$#\[\]\/\u0000-\u001f\u007f]{1,128}$/;
  function checkKey(k, what) {
    if (typeof k !== 'string' || !KEY_RE.test(k)) {
      throw new Error(what + ' 不合法（不可含 . $ # [ ] / 或控制字元，長度 1–128）：' + k);
    }
  }
  function toObj(v) {
    if (!Array.isArray(v)) return v || {};
    const o = {};
    v.forEach((x, i) => { if (x != null) o[i] = x; });
    return o;
  }
  const data = {
    newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    async list(col) {
      checkKey(col, 'collection');
      return toObj(await rtdb('GET', p('data', col)));
    },
    // PATCH 單筆：只送出該筆記錄，不會覆蓋別人改的其他筆
    async save(col, id, rec) {
      checkKey(col, 'collection');
      checkKey(id, 'id');
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('record 必須是物件');
      Object.keys(rec).forEach((k) => checkKey(k, '欄位名稱'));
      await rtdb('PATCH', p('data', col, id), rec);
    },
    async remove(col, id) {
      checkKey(col, 'collection');
      checkKey(id, 'id');
      await rtdb('DELETE', p('data', col, id));
    },
    checkKey,
    toObj
  };

  window.Adapter = {
    provider: 'firebase-rtdb',
    cfg, AdapterError, session, setSession, clearSession, getToken, identity, rtdb, streamUrl, bindMember, jwt, p,
    emailKey, data
  };
})();
