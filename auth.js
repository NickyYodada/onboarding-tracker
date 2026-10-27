/* auth.js（magic-link）【鎖定檔，禁止修改】
 * 登入方式：邀請連結。管理員在「管理」面板為每位成員建立專屬連結；成員開啟連結即登入，代碼會存在這個瀏覽器。
 * 實作：Firebase 匿名登入 + 名冊代碼（roster/<token>）。撤銷代碼後，該成員立即失去存取權。
 * 契約：window.Auth = { init(): Promise<Session|null>, render(el, onSuccess), signOut(), notice }
 *   Session = { uid, key, name, role, email }
 */
(function () {
  'use strict';
  const A = window.Adapter;
  const TKEY = 'mws:' + A.cfg.projectId + ':token';
  const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

  function h(tag, props) {
    const e = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => {
      if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    for (let i = 2; i < arguments.length; i++) if (arguments[i]) e.appendChild(arguments[i]);
    return e;
  }

  // 從網址 hash 取出 token，並立刻從網址移除（避免留在歷史紀錄或被轉貼）
  function takeUrlToken() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!params.has('token')) return null;
    const t = params.get('token');
    params.delete('token');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
    return t;
  }

  function parseToken(s) {
    s = String(s || '').trim();
    const m = /[#&?]token=([A-Za-z0-9_-]+)/.exec(s);
    const t = m ? m[1] : s;
    return TOKEN_RE.test(t) ? t : null;
  }

  async function ensureAnon() {
    if (A.session()) {
      try { await A.getToken(); return; } catch (e) { if (e.kind !== 'auth') throw e; }
    }
    let d;
    try {
      d = await A.identity('accounts:signUp', { returnSecureToken: true });
    } catch (e) {
      if (e.code === 'ADMIN_ONLY_OPERATION' || e.code === 'OPERATION_NOT_ALLOWED') {
        throw new Error('此專案尚未啟用匿名登入（Firebase Console → Authentication → Sign-in method → Anonymous）');
      }
      throw e;
    }
    A.setSession({ uid: d.localId, idToken: d.idToken, refreshToken: d.refreshToken, expiresIn: d.expiresIn });
  }

  const Auth = {
    notice: '',

    async init() {
      const fromUrl = takeUrlToken();
      const stored = localStorage.getItem(TKEY);
      const tries = [];
      if (fromUrl) {
        if (TOKEN_RE.test(fromUrl)) tries.push({ t: fromUrl, url: true });
        else Auth.notice = '連結格式不正確，請向管理員索取新的連結';
      }
      if (stored && stored !== fromUrl) tries.push({ t: stored, url: false });
      if (!tries.length) return null;

      await ensureAnon();
      for (const c of tries) {
        const entry = await A.bindMember(c.t);
        if (entry) {
          Auth.notice = '';
          localStorage.setItem(TKEY, c.t);
          return { uid: A.session().uid, key: c.t, name: entry.name, role: entry.role, email: null };
        }
        if (!c.url) localStorage.removeItem(TKEY);
        Auth.notice = c.url ? '此連結無效或已被撤銷，請向管理員索取新的連結' : '你的存取權已被撤銷或停用，請向管理員索取新的連結';
      }
      return null;
    },

    render(el, onSuccess) {
      el.textContent = '';
      const input = h('input', { type: 'text', class: 'input w-full', placeholder: '貼上邀請連結', autocomplete: 'off', spellcheck: 'false' });
      const err = h('div', { class: 'mws-err', hidden: '' });
      const form = h('form', { class: 'space-y-3' },
        h('div', { class: 'mws-note', text: '請開啟管理員給你的專屬連結；也可以把連結（或其中的代碼）貼在下方。' }),
        h('div', { class: 'mws-field' }, h('label', { text: '貼上邀請連結' }), input),
        err,
        h('button', { type: 'submit', class: 'btn btn-primary w-full', text: '登入' }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const t = parseToken(input.value);
        if (!t) {
          err.hidden = false;
          err.textContent = '找不到有效的代碼，請確認貼上的是完整的邀請連結';
          return;
        }
        localStorage.setItem(TKEY, t);
        onSuccess();
      });
      el.appendChild(form);
    },

    // 清除這個瀏覽器的憑證；伺服器端的 members 紀錄無人能再使用，無需（也無法）解除綁定
    signOut() {
      localStorage.removeItem(TKEY);
      A.clearSession();
    }
  };

  window.Auth = Auth;
})();
