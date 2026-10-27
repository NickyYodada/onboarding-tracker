/* app.js — 你的應用程式邏輯（擴充區，可自由修改；靜態畫面結構寫在 index.html 的 #appRoot 內）
 *
 * 契約：window.App = { mount(root, ctx) }，只透過 ctx 取得資料與使用者。
 *   ctx.session   { uid, key, name, role, email }；公開且未登入時為 null
 *   ctx.canWrite  是否顯示編輯功能（僅為 UI 提示；真正的權限由 rules 強制）
 *   ctx.Sync      資料層（見下），動態資料一律存在資料庫，不可寫死在 HTML 或 JS 裡
 *   ctx.I18n      中英語言切換（lang: 'zh'|'en', t(zh, en), setLang(l), toggle(), apply(el), onChange(fn)）
 *   ctx.cfg       APP_CONFIG（唯讀）
 *
 * ctx.Sync：
 *   newId()                      產生新的記錄 id
 *   list(col)                    讀一次，回傳 { id: record }
 *   save(col, id, rec)           新增或「合併更新」單筆；欄位設為 null 代表刪除該欄位
 *   remove(col, id)              刪除單筆
 *   subscribe(col, handlers)     handlers = { onChange(map), onError(err), onStatus(s) }
 *                                回傳 { refresh(), stop() }
 *     onChange(map)：資料載入後、遠端變更時、自己寫入成功後都會呼叫，map 為完整的 { id: record }。
 *                    它可能在任何時候到達，重繪時不要打斷使用者正在編輯的欄位。
 *     onStatus(s)：loading | live | offline | denied | auth（以它顯示連線狀態為主）
 *     onError(err)：載入或連線失敗時呼叫；暫時性斷線只會改變 status，不一定呼叫 onError
 *   錯誤物件的 err.kind：network | auth | denied | http
 *   資料形狀：欄位值用字串、數字、布林；清單請用「id → 物件」的 map，不要用陣列或空物件
 *            （RTDB 會改變它們的形狀）。欄位名稱不可含 . $ # [ ] /
 */
(function () {
  'use strict';
  var COL = 'onboarding_members';

  var MILESTONES = [
    { key: 'm01', num: '01', zh: '接受錄取通知', en: 'Offer accepted', bold: false },
    { key: 'm02', num: '02', zh: '報到前準備', en: 'Pre-readiness', bold: false },
    { key: 'm03', num: '03', zh: '正式報到日', en: 'On-board date', bold: true },
    { key: 'm04', num: '04', zh: '正式就緒培訓', en: 'Official readiness', bold: true },
    { key: 'm05', num: '05', zh: '承接首個案件', en: 'First case taken', bold: false },
    { key: 'm06', num: '06', zh: '加入日常輪班', en: 'Join daily shift', bold: false }
  ];

  var COLORS = ['blue', 'sky', 'teal', 'indigo', 'amber'];
  var STATUS_ORDER = ['pending', 'in_progress', 'completed'];

  function h(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  window.App = {
    mount: function (root, ctx) {
      var $ = function (id) { return root.querySelector('#' + id); };
      var sync = ctx.Sync;
      var i18n = ctx.I18n || { lang: 'zh', t: function (z) { return z; }, onChange: function () {} };
      var realtime = sync.mode === 'realtime-sse';
      var curStatus = 'loading';

      function statusLabel(s) {
        var map = {
          loading: i18n.t('載入中…', 'Loading…'),
          live: realtime ? i18n.t('即時同步中', 'Live Sync') : i18n.t('已同步', 'Synced'),
          offline: i18n.t('離線，重新連線中…', 'Offline, reconnecting…'),
          denied: i18n.t('沒有權限讀取資料', 'Permission denied'),
          auth: i18n.t('登入已失效，請重新整理頁面', 'Session expired, please refresh')
        };
        return map[s] || s;
      }

      function pillLabel(st) {
        if (st === 'completed') return i18n.t('已完成', 'COMPLETED');
        if (st === 'in_progress') return i18n.t('進行中', 'IN PROGRESS');
        return i18n.t('待處理', 'PENDING');
      }

      var latest = {};
      var editing = false;

      var statusEl = $('statusText');
      var errEl = $('errBox');
      var headEl = $('boardHead');
      var bodyEl = $('boardBody');
      var addForm = $('addForm');
      var memberInput = $('memberInput');
      var colorSelect = $('colorSelect');
      var refreshBtn = $('refreshBtn');

      function showErr(e) {
        errEl.hidden = false;
        errEl.textContent = e && e.kind === 'denied'
          ? i18n.t('沒有權限執行這個動作（角色不足或存取已被撤銷）', 'Permission denied (insufficient role or access revoked)')
          : (e && e.message) || String(e);
      }

      function run(promise) {
        errEl.hidden = true;
        promise.catch(showErr);
      }

      function sortedIds() {
        return Object.keys(latest).sort(function (a, b) {
          return (latest[a].createdAt || 0) - (latest[b].createdAt || 0);
        });
      }

      function nextColor(count) {
        return COLORS[count % COLORS.length];
      }

      function render() {
        if (editing) return;
        statusEl.textContent = statusLabel(curStatus);
        headEl.textContent = '';
        bodyEl.textContent = '';

        var ids = sortedIds();

        var headRow = h('tr', {});
        headRow.appendChild(
          h('th', { class: 'ot-th-milestone px-5 py-4 text-left text-xs font-bold tracking-widest uppercase' },
            i18n.t('里程碑項目', 'MILESTONE')
          )
        );

        if (!ids.length) {
          headRow.appendChild(
            h('th', { class: 'ot-th-member ot-header-blue px-5 py-4 text-left text-sm font-medium opacity-90' },
              i18n.t('尚未新增成員（請由上方表單新增）', 'No team members yet (Add via form above)')
            )
          );
          headEl.appendChild(headRow);

          MILESTONES.forEach(function (ms) {
            var tr = h('tr', { class: 'ot-row' });
            var titleClass = ms.bold ? 'font-bold text-base-content' : 'font-medium text-base-content/90';
            tr.appendChild(
              h('td', { class: 'ot-cell-milestone px-5 py-4' },
                h('div', { class: 'flex items-center gap-3.5' },
                  h('span', { class: 'text-xs font-bold text-base-content/50 w-5', text: ms.num }),
                  h('span', { class: 'text-sm md:text-base ' + titleClass, text: i18n.t(ms.zh, ms.en) })
                )
              )
            );
            tr.appendChild(
              h('td', { class: 'ot-cell-member px-5 py-4 text-sm text-base-content/40' }, '—')
            );
            bodyEl.appendChild(tr);
          });
          return;
        }

        ids.forEach(function (id, idx) {
          var rec = latest[id] || {};
          var color = COLORS.indexOf(rec.color) >= 0 ? rec.color : COLORS[idx % COLORS.length];
          var nameStr = rec.name || i18n.t('未命名', 'Unnamed');
          var initial = nameStr.trim().charAt(0).toUpperCase() || '?';

          var nameEl = h('span', { class: 'font-bold text-base md:text-lg truncate', text: nameStr });
          var leftWrap = h('div', { class: 'flex items-center gap-3 min-w-0 flex-1' },
            h('span', { class: 'ot-avatar', text: initial }),
            nameEl
          );

          var actionsWrap = h('div', { class: 'flex items-center gap-1' });
          if (ctx.canWrite) {
            nameEl.className += ' cursor-pointer hover:underline';
            nameEl.title = i18n.t('點擊修改姓名', 'Click to edit name');
            nameEl.addEventListener('click', function () {
              startEditName(id, rec, leftWrap, nameEl);
            });

            var colorBtnTitle = i18n.t('切換標題顏色', 'Cycle header color');
            actionsWrap.appendChild(
              h('button', {
                type: 'button',
                class: 'btn btn-ghost btn-xs btn-circle text-white/80 hover:text-white hover:bg-white/20',
                title: colorBtnTitle,
                'aria-label': colorBtnTitle,
                onclick: function () {
                  var next = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
                  run(sync.save(COL, id, { color: next }));
                }
              }, h('i', { class: 'fa-solid fa-palette text-xs', 'aria-hidden': 'true' }))
            );

            var delTitle = i18n.t('刪除此成員', 'Remove member');
            actionsWrap.appendChild(
              h('button', {
                type: 'button',
                class: 'btn btn-ghost btn-xs btn-circle text-white/80 hover:text-white hover:bg-white/20',
                title: delTitle,
                'aria-label': delTitle,
                onclick: function () {
                  run(sync.remove(COL, id));
                }
              }, h('i', { class: 'fa-regular fa-trash-can text-xs', 'aria-hidden': 'true' }))
            );
          }

          var th = h('th', { class: 'ot-th-member ot-header-' + color + ' px-5 py-3.5 text-left' },
            h('div', { class: 'flex items-center justify-between gap-2' }, leftWrap, actionsWrap)
          );
          headRow.appendChild(th);
        });

        headEl.appendChild(headRow);

        MILESTONES.forEach(function (ms) {
          var tr = h('tr', { class: 'ot-row' });
          var titleClass = ms.bold ? 'font-bold text-base-content' : 'font-medium text-base-content/90';
          tr.appendChild(
            h('td', { class: 'ot-cell-milestone px-5 py-4' },
              h('div', { class: 'flex items-center gap-3.5' },
                h('span', { class: 'text-xs font-bold text-base-content/50 w-5', text: ms.num }),
                h('span', { class: 'text-sm md:text-base ' + titleClass, text: i18n.t(ms.zh, ms.en) })
              )
            )
          );

          ids.forEach(function (id) {
            var rec = latest[id] || {};
            var stKey = ms.key + '_status';
            var noteKey = ms.key + '_note';
            var st = STATUS_ORDER.indexOf(rec[stKey]) >= 0 ? rec[stKey] : 'pending';
            var noteVal = rec[noteKey] || '';

            var pillEl;
            if (ctx.canWrite) {
              pillEl = h('button', {
                type: 'button',
                class: 'ot-pill ot-pill-' + st,
                title: i18n.t('點擊切換狀態', 'Click to cycle status'),
                text: pillLabel(st),
                onclick: function () {
                  var nextSt = STATUS_ORDER[(STATUS_ORDER.indexOf(st) + 1) % STATUS_ORDER.length];
                  var patch = {};
                  patch[stKey] = nextSt;
                  run(sync.save(COL, id, patch));
                }
              });
            } else {
              pillEl = h('span', {
                class: 'ot-pill ot-pill-' + st,
                text: pillLabel(st)
              });
            }

            var noteEl = h('span', {
              class: 'ot-date-btn' + (ctx.canWrite ? ' editable' : ''),
              text: noteVal ? noteVal : '—'
            });

            var cellInner = h('div', { class: 'flex items-center justify-between gap-2' }, pillEl, noteEl);

            if (ctx.canWrite) {
              noteEl.title = i18n.t('點擊編輯日期或備註', 'Click to edit date or note');
              noteEl.addEventListener('click', function () {
                startEditNote(id, noteKey, noteVal, cellInner, noteEl);
              });
            }

            tr.appendChild(h('td', { class: 'ot-cell-member px-5 py-4' }, cellInner));
          });

          bodyEl.appendChild(tr);
        });
      }

      function startEditName(id, rec, container, nameEl) {
        editing = true;
        var input = h('input', {
          type: 'text',
          maxlength: '60',
          class: 'input input-xs text-base-content w-full max-w-40',
          value: rec.name || ''
        });
        container.replaceChild(input, nameEl);
        input.focus();
        input.select();
        var done = false;
        function finish(save) {
          if (done) return;
          done = true;
          editing = false;
          var v = input.value.trim().slice(0, 60);
          if (save && v && v !== rec.name) {
            run(sync.save(COL, id, { name: v }));
          }
          render();
        }
        input.addEventListener('blur', function () { finish(true); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        });
      }

      function startEditNote(id, noteKey, oldVal, container, noteEl) {
        editing = true;
        var input = h('input', {
          type: 'text',
          maxlength: '40',
          placeholder: i18n.t('MM/DD 或備註', 'MM/DD or note'),
          class: 'input input-xs w-28 text-right',
          value: oldVal || ''
        });
        container.replaceChild(input, noteEl);
        input.focus();
        input.select();
        var done = false;
        function finish(save) {
          if (done) return;
          done = true;
          editing = false;
          var v = input.value.trim().slice(0, 40);
          if (save && v !== oldVal) {
            var patch = {};
            patch[noteKey] = v ? v : null;
            run(sync.save(COL, id, patch));
          }
          render();
        }
        input.addEventListener('blur', function () { finish(true); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        });
      }

      if (ctx.canWrite) {
        addForm.hidden = false;
        addForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var name = memberInput.value.trim().slice(0, 60);
          if (!name) return;
          var chosenColor = colorSelect.value || nextColor(sortedIds().length);
          memberInput.value = '';
          var countAfter = sortedIds().length + 1;
          colorSelect.value = nextColor(countAfter);
          run(sync.save(COL, sync.newId(), {
            name: name,
            color: chosenColor,
            createdAt: Date.now(),
            by: ctx.session ? ctx.session.name : null
          }));
        });
      }

      refreshBtn.addEventListener('click', function () { sub.refresh(); });
      i18n.onChange(function () { render(); });

      var sub = sync.subscribe(COL, {
        onChange: function (map) {
          latest = map || {};
          if (ctx.canWrite && document.activeElement !== colorSelect) {
            colorSelect.value = nextColor(sortedIds().length);
          }
          render();
        },
        onError: showErr,
        onStatus: function (s) {
          curStatus = s;
          statusEl.textContent = statusLabel(s);
        }
      });
    }
  };
})();
