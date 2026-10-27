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
  var PPTX_CDN = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';

  var MILESTONES = [
    { key: 'm01', num: '01', zh: '接受錄取通知', en: 'Offer accepted' },
    { key: 'm02', num: '02', zh: '報到前準備', en: 'Pre-readiness' },
    { key: 'm03', num: '03', zh: '正式報到日', en: 'On-board date' },
    { key: 'm04', num: '04', zh: '正式就緒培訓', en: 'Official readiness' },
    { key: 'm05', num: '05', zh: '承接首個案件', en: 'First case taken' },
    { key: 'm06', num: '06', zh: '加入日常輪班', en: 'Join daily shift' }
  ];

  var COLORS = ['blue', 'sky', 'teal', 'indigo', 'amber'];
  var COLOR_HEX = {
    blue: { bg: '0B74CB', circle: '4897D8' },
    sky: { bg: '2C8BD6', circle: '61A8E0' },
    teal: { bg: '0A8276', circle: '47A198' },
    indigo: { bg: '4353B5', circle: '727EC8' },
    amber: { bg: 'C77716', circle: 'D59950' }
  };
  var STATUS_ORDER = ['pending', 'in_progress', 'completed'];

  var pptxLoading = null;
  function ensurePptxGen() {
    if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
    if (pptxLoading) return pptxLoading;
    pptxLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PPTX_CDN;
      s.onload = function () {
        if (window.PptxGenJS) resolve(window.PptxGenJS);
        else reject(new Error('PptxGenJS 載入失敗'));
      };
      s.onerror = function () {
        pptxLoading = null;
        reject(new Error('無法載入 PPTX 匯出套件 (' + PPTX_CDN + ')'));
      };
      document.head.appendChild(s);
    });
    return pptxLoading;
  }

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
      var exportPptxBtn = $('exportPptxBtn');

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
            tr.appendChild(
              h('td', { class: 'ot-cell-milestone px-5 py-4' },
                h('div', { class: 'flex items-center gap-3.5' },
                  h('span', { class: 'text-xs font-bold text-base-content/50 w-5', text: ms.num }),
                  h('span', { class: 'text-sm md:text-base font-medium text-base-content/90', text: i18n.t(ms.zh, ms.en) })
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
          tr.appendChild(
            h('td', { class: 'ot-cell-milestone px-5 py-4' },
              h('div', { class: 'flex items-center gap-3.5' },
                h('span', { class: 'text-xs font-bold text-base-content/50 w-5', text: ms.num }),
                h('span', { class: 'text-sm md:text-base font-medium text-base-content/90', text: i18n.t(ms.zh, ms.en) })
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

      function exportToPptx() {
        errEl.hidden = true;
        exportPptxBtn.disabled = true;
        ensurePptxGen().then(function (PptxGenJS) {
          var pres = new PptxGenJS();
          pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inches
          pres.title = 'Onboarding tracker';

          var slide = pres.addSlide();
          slide.background = { color: 'F8FAFC' };

          var fontFace = i18n.lang === 'en' ? 'Segoe UI' : 'Microsoft JhengHei';

          // Top headers matching visual design
          slide.addText(i18n.t('人員準備度', 'PEOPLE READINESS'), {
            x: 0.35, y: 0.25, w: 8, h: 0.22,
            fontFace: fontFace, fontSize: 9.5, bold: true, color: '0B74CB', charSpacing: 1.5, margin: 0
          });
          slide.addText(i18n.t('新人報到追蹤表', 'Onboarding tracker'), {
            x: 0.35, y: 0.50, w: 10, h: 0.45,
            fontFace: fontFace, fontSize: 24, bold: true, color: '0F2537', margin: 0
          });
          slide.addText(i18n.t('單一視圖掌握每位新進團隊成員的報到前里程碑與營運上手進度。', 'A single view of pre-readiness milestones and operational ramp-up for each new team member.'), {
            x: 0.35, y: 1.02, w: 12, h: 0.25,
            fontFace: fontFace, fontSize: 11, color: '526578', margin: 0
          });

          // Table geometry
          var tableX = 0.35;
          var tableY = 1.48;
          var totalW = 12.63;
          var msW = 3.15;
          var headerH = 0.68;
          var rowH = 0.72;

          var ids = sortedIds();
          var colCount = Math.max(ids.length, 1);
          var memberW = (totalW - msW) / colCount;

          // Outer table border background
          slide.addShape(pres.ShapeType.rect, {
            x: tableX, y: tableY, w: totalW, h: headerH + MILESTONES.length * rowH,
            fill: { color: 'FFFFFF' },
            line: { color: 'DDE3EA', width: 1 }
          });

          // Header: Milestone column
          slide.addShape(pres.ShapeType.rect, {
            x: tableX, y: tableY, w: msW, h: headerH,
            fill: { color: '162B40' },
            line: { color: 'DDE3EA', width: 0.75 }
          });
          slide.addText(i18n.t('里程碑項目', 'MILESTONE'), {
            x: tableX + 0.22, y: tableY, w: msW - 0.3, h: headerH,
            fontFace: fontFace, fontSize: 9.5, bold: true, color: 'FFFFFF', valign: 'middle', charSpacing: 1.2, margin: 0
          });

          // Header: Member columns
          if (!ids.length) {
            slide.addShape(pres.ShapeType.rect, {
              x: tableX + msW, y: tableY, w: memberW, h: headerH,
              fill: { color: '0B74CB' },
              line: { color: 'DDE3EA', width: 0.75 }
            });
            slide.addText(i18n.t('尚未新增成員', 'No team members yet'), {
              x: tableX + msW + 0.25, y: tableY, w: memberW - 0.4, h: headerH,
              fontFace: fontFace, fontSize: 12, bold: true, color: 'FFFFFF', valign: 'middle', margin: 0
            });
          } else {
            ids.forEach(function (id, idx) {
              var rec = latest[id] || {};
              var cKey = COLORS.indexOf(rec.color) >= 0 ? rec.color : COLORS[idx % COLORS.length];
              var pal = COLOR_HEX[cKey] || COLOR_HEX.blue;
              var cx = tableX + msW + idx * memberW;

              slide.addShape(pres.ShapeType.rect, {
                x: cx, y: tableY, w: memberW, h: headerH,
                fill: { color: pal.bg },
                line: { color: 'DDE3EA', width: 0.75 }
              });

              // Avatar circle
              var avatarSize = 0.36;
              slide.addShape(pres.ShapeType.ellipse, {
                x: cx + 0.22, y: tableY + (headerH - avatarSize) / 2, w: avatarSize, h: avatarSize,
                fill: { color: pal.circle },
                line: { color: pal.circle, width: 0 }
              });

              var nameStr = rec.name || i18n.t('未命名', 'Unnamed');
              slide.addText(nameStr, {
                x: cx + 0.68, y: tableY, w: memberW - 0.78, h: headerH,
                fontFace: fontFace, fontSize: 13.5, bold: true, color: 'FFFFFF', valign: 'middle', margin: 0
              });
            });
          }

          // Rows: Milestones 01-06 (uniform font styling)
          MILESTONES.forEach(function (ms, rIdx) {
            var ry = tableY + headerH + rIdx * rowH;

            // Milestone left cell
            slide.addShape(pres.ShapeType.rect, {
              x: tableX, y: ry, w: msW, h: rowH,
              fill: { color: 'F8FAFC' },
              line: { color: 'E2E8F0', width: 0.75 }
            });

            slide.addText(ms.num, {
              x: tableX + 0.22, y: ry, w: 0.35, h: rowH,
              fontFace: fontFace, fontSize: 9, bold: true, color: '64748B', valign: 'middle', margin: 0
            });

            slide.addText(i18n.t(ms.zh, ms.en), {
              x: tableX + 0.58, y: ry, w: msW - 0.68, h: rowH,
              fontFace: fontFace, fontSize: 11.5, bold: false, color: '1E293B', valign: 'middle', margin: 0
            });

            if (!ids.length) {
              slide.addShape(pres.ShapeType.rect, {
                x: tableX + msW, y: ry, w: memberW, h: rowH,
                fill: { color: 'FFFFFF' },
                line: { color: 'E2E8F0', width: 0.75 }
              });
              slide.addText('—', {
                x: tableX + msW + 0.25, y: ry, w: memberW - 0.5, h: rowH,
                fontFace: fontFace, fontSize: 11, color: '94A3B8', valign: 'middle', margin: 0
              });
              return;
            }

            ids.forEach(function (id, cIdx) {
              var rec = latest[id] || {};
              var stKey = ms.key + '_status';
              var noteKey = ms.key + '_note';
              var st = STATUS_ORDER.indexOf(rec[stKey]) >= 0 ? rec[stKey] : 'pending';
              var noteVal = rec[noteKey] || '—';

              var cx = tableX + msW + cIdx * memberW;

              slide.addShape(pres.ShapeType.rect, {
                x: cx, y: ry, w: memberW, h: rowH,
                fill: { color: 'FFFFFF' },
                line: { color: 'E2E8F0', width: 0.75 }
              });

              var pillColors = {
                pending: { bg: 'EEF2F6', fg: '64748B' },
                in_progress: { bg: 'DBEAFE', fg: '0B6BCB' },
                completed: { bg: 'D1FAE5', fg: '067647' }
              }[st];

              var pillW = Math.min(1.05, memberW * 0.46);
              var pillH = 0.30;
              var pillX = cx + 0.22;
              var pillY = ry + (rowH - pillH) / 2;

              slide.addShape(pres.ShapeType.roundRect, {
                x: pillX, y: pillY, w: pillW, h: pillH,
                rectRadius: 0.06,
                fill: { color: pillColors.bg },
                line: { color: pillColors.bg, width: 0 }
              });

              slide.addText(pillLabel(st), {
                x: pillX, y: pillY, w: pillW, h: pillH,
                fontFace: fontFace, fontSize: 7.5, bold: true, color: pillColors.fg,
                align: 'center', valign: 'middle', margin: 0
              });

              var noteX = pillX + pillW + 0.08;
              var noteW = Math.max(0.4, memberW - (pillW + 0.52));
              slide.addText(noteVal, {
                x: noteX, y: ry, w: noteW, h: rowH,
                fontFace: fontFace, fontSize: 9.5, color: '64748B',
                align: 'right', valign: 'middle', margin: 0
              });
            });
          });

          // Legend at bottom right
          var legY = 6.72;
          slide.addText(i18n.t('圖例', 'Legend'), {
            x: 9.45, y: legY, w: 0.65, h: 0.22,
            fontFace: fontFace, fontSize: 8.5, bold: true, color: '475569', valign: 'middle', margin: 0
          });

          var legends = [
            { color: '0A8276', label: i18n.t('已完成', 'Completed'), x: 10.15, w: 0.95 },
            { color: '0B74CB', label: i18n.t('進行中', 'In progress'), x: 11.18, w: 0.95 },
            { color: 'CBD5E1', label: i18n.t('待處理', 'Pending'), x: 12.20, w: 0.85 }
          ];
          legends.forEach(function (lg) {
            slide.addShape(pres.ShapeType.ellipse, {
              x: lg.x, y: legY + 0.045, w: 0.13, h: 0.13,
              fill: { color: lg.color },
              line: { color: lg.color, width: 0 }
            });
            slide.addText(lg.label, {
              x: lg.x + 0.17, y: legY, w: lg.w - 0.17, h: 0.22,
              fontFace: fontFace, fontSize: 8, color: '64748B', valign: 'middle', margin: 0
            });
          });

          // Footer
          slide.addText('FY27 PRIORITY  |  CUSTOMER MOMENTUM  |  PROJECT P', {
            x: 0.35, y: 7.08, w: 6, h: 0.2,
            fontFace: fontFace, fontSize: 8, bold: true, color: '64748B', margin: 0
          });
          slide.addText('2', {
            x: 12.5, y: 7.08, w: 0.48, h: 0.2,
            fontFace: fontFace, fontSize: 8, color: '64748B', align: 'right', margin: 0
          });

          return pres.writeFile({ fileName: 'Onboarding-tracker.pptx' });
        }).catch(showErr).finally(function () {
          exportPptxBtn.disabled = false;
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
      if (exportPptxBtn) {
        exportPptxBtn.addEventListener('click', exportToPptx);
      }
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
