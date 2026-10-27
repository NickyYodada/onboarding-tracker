/* admin.js（token-admin）【鎖定檔，禁止修改】
 * 成員管理面板（邀請連結）：為每位成員建立專屬連結、改角色、停用／啟用、刪除。
 * 只有管理員看得到入口；真正的權限由 rules 強制（非管理員的請求一律被拒絕）。
 * 「自己」那一列不能被修改，確保至少還有一位啟用中的管理員。
 * 契約：window.Admin = { mount(el, ctx) }
 */
(function () {
  'use strict';
  const A = window.Adapter;
  const ROLES = { admin: '管理員', editor: '編輯者', viewer: '檢視者' };

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
  function roleSelect(value, small) {
    const s = h('select', { class: 'select' + (small ? ' select-sm w-28' : ' w-32'), 'aria-label': '角色' });
    Object.keys(ROLES).forEach((r) => {
      const o = h('option', { value: r, text: ROLES[r] });
      if (r === value) o.selected = true;
      s.appendChild(o);
    });
    return s;
  }
  // 24 個隨機位元組 → 32 字元的 base64url 代碼
  function newToken() {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  window.Admin = {
    mount(el, ctx) {
      const me = ctx.session.key;
      let roster = {};
      const err = h('div', { class: 'mws-err', hidden: '' });
      const ok = h('div', { class: 'mws-note', hidden: '' });
      const tbody = h('tbody');

      const showErr = (e) => {
        err.hidden = false;
        err.textContent = e && e.kind === 'denied' ? '沒有權限（你的角色可能已不是管理員）' : (e && e.message) || String(e);
      };
      async function load() {
        roster = (await A.rtdb('GET', A.p('roster'))) || {};
        draw();
      }
      async function act(fn) {
        err.hidden = true;
        ok.hidden = true;
        try { await fn(); await load(); } catch (e) { showErr(e); }
      }
      async function copyLink(token) {
        const link = location.origin + location.pathname + '#token=' + token;
        try {
          await navigator.clipboard.writeText(link);
          ok.hidden = false;
          ok.textContent = '連結已複製，請傳給對方。';
        } catch (e) {
          prompt('請複製這個連結', link);
        }
      }

      function row(key, m) {
        const self = key === me;
        const role = roleSelect(m.role, true);
        role.addEventListener('change', () => act(() => A.rtdb('PATCH', A.p('roster', key), { role: role.value })));
        const copy = h('button', { type: 'button', class: 'btn btn-xs', text: '複製連結', onclick: () => copyLink(key) });
        const toggle = h('button', { type: 'button', class: 'btn btn-xs', text: m.active ? '停用' : '啟用',
          onclick: () => act(() => A.rtdb('PATCH', A.p('roster', key), { active: !m.active })) });
        const del = h('button', { type: 'button', class: 'btn btn-ghost btn-xs text-error', text: '刪除',
          onclick: () => { if (confirm('確定要刪除「' + m.name + '」嗎？該連結會立即失效。')) act(() => A.rtdb('DELETE', A.p('roster', key))); } });
        if (self) { role.disabled = true; toggle.disabled = true; del.disabled = true; }
        return h('tr', {},
          h('td', { text: m.name + (self ? '（你）' : '') }),
          h('td', {}, role),
          h('td', {}, h('span', { class: 'badge badge-sm ' + (m.active ? 'badge-success badge-soft' : 'badge-ghost'), text: m.active ? '啟用中' : '已停用' })),
          h('td', {}, h('div', { class: 'flex items-center gap-1.5' }, copy, toggle, del)));
      }

      function draw() {
        tbody.textContent = '';
        const keys = Object.keys(roster).sort((a, b) => String(roster[a].name).localeCompare(String(roster[b].name)));
        if (!keys.length) { tbody.appendChild(h('tr', {}, h('td', { colspan: '4', class: 'mws-note', text: '名單是空的' }))); return; }
        keys.forEach((k) => tbody.appendChild(row(k, roster[k])));
      }

      const nameIn = h('input', { type: 'text', class: 'input flex-1 min-w-40', placeholder: '姓名', required: '' });
      const roleIn = roleSelect('viewer', false);
      const addForm = h('form', { class: 'mws-row' }, nameIn, roleIn,
        h('button', { type: 'submit', class: 'btn btn-primary', text: '建立連結' }));
      addForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        act(async () => {
          const name = nameIn.value.trim().slice(0, 80);
          if (!name) throw new Error('請輸入姓名');
          await A.rtdb('PUT', A.p('roster', newToken()), { name, role: roleIn.value, active: true, createdAt: Date.now() });
          nameIn.value = '';
          ok.hidden = false;
          ok.textContent = '已建立「' + name + '」。請在列表按「複製連結」傳給對方。';
        });
      });

      el.appendChild(h('div', { class: 'space-y-3' },
        addForm,
        err,
        ok,
        h('div', { class: 'overflow-x-auto bg-base-100 rounded-box' },
          h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', { text: '姓名' }), h('th', { text: '角色' }), h('th', { text: '狀態' }), h('th', { text: '操作' }))),
            tbody)),
        h('div', { class: 'mws-row pt-1' },
          h('span', { class: 'text-xs text-base-content/70 flex-1', text: '連結等同密碼，請只傳給本人。停用或刪除會立即生效。' }),
          h('button', { type: 'button', class: 'btn btn-sm', text: '重新整理', onclick: () => { err.hidden = true; load().catch(showErr); } }))));
      load().catch(showErr);
    }
  };
})();
