/* sync.js（on-demand 模式）【鎖定檔，禁止修改】
 * 讀取時才抓資料；自己的寫入會立刻反映在畫面；別人的變更要按「重新整理」才看得到。
 * 契約（Sync API）見 app.js 開頭註解。所有 CRUD 都經過 Adapter.data。
 */
(function () {
  'use strict';
  const A = window.Adapter;
  const cache = {};    // col -> { id: record }；載入成功後才會有值
  const subs = {};     // col -> Set(handlers)
  const ver = {};      // col -> 本機寫入次數，用來偵測「載入進行中又發生寫入」
  const inflight = {}; // col -> 進行中的載入 Promise

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const call = (fn, arg) => { try { if (fn) fn(arg); } catch (e) { console.error(e); } };
  const handlers = (col) => Array.from(subs[col] || []);
  const statusOf = (e) => (e && (e.kind === 'denied' || e.kind === 'auth') ? e.kind : 'offline');

  function emitStatus(col, s) { handlers(col).forEach((h) => call(h.onStatus, s)); }
  function emitData(col) {
    if (!cache[col]) return;
    handlers(col).forEach((h) => call(h.onChange, clone(cache[col])));
  }

  // 載入期間若有本機寫入完成，這次的結果可能不含該寫入 → 重新抓；連續 3 次都撞到就採用最後一次
  async function fetchOnce(col) {
    let map;
    for (let i = 0; i < 3; i++) {
      const v = ver[col] || 0;
      map = await A.data.list(col);
      if ((ver[col] || 0) === v) break;
    }
    cache[col] = map;
  }

  function load(col) {
    if (inflight[col]) return inflight[col];
    emitStatus(col, 'loading');
    inflight[col] = fetchOnce(col).then(
      () => { delete inflight[col]; emitStatus(col, 'live'); emitData(col); },
      (e) => {
        delete inflight[col];
        emitStatus(col, statusOf(e));
        handlers(col).forEach((h) => call(h.onError, e));
      }
    );
    return inflight[col];
  }

  // 與伺服器 PATCH 語意一致：欄位為 null 代表刪除；整筆變空就移除該筆
  function mergeInto(map, id, rec) {
    const next = Object.assign({}, map[id] || {});
    const sent = JSON.parse(JSON.stringify(rec));
    Object.keys(sent).forEach((k) => { if (sent[k] === null) delete next[k]; else next[k] = sent[k]; });
    if (Object.keys(next).length) map[id] = next; else delete map[id];
  }

  window.Sync = {
    mode: 'on-demand',
    newId: () => A.data.newId(),
    list: (col) => A.data.list(col),

    async save(col, id, rec) {
      await A.data.save(col, id, rec);
      ver[col] = (ver[col] || 0) + 1;
      if (cache[col]) { mergeInto(cache[col], id, rec); emitData(col); }
    },

    async remove(col, id) {
      await A.data.remove(col, id);
      ver[col] = (ver[col] || 0) + 1;
      if (cache[col]) { delete cache[col][id]; emitData(col); }
    },

    subscribe(col, h) {
      A.data.checkKey(col, 'collection');
      h = h || {};
      (subs[col] || (subs[col] = new Set())).add(h);
      if (cache[col]) {
        Promise.resolve().then(() => {
          if (!subs[col].has(h)) return;
          call(h.onStatus, 'live');
          call(h.onChange, clone(cache[col]));
        });
      } else if (inflight[col]) {
        call(h.onStatus, 'loading');
      } else {
        load(col);
      }
      return {
        refresh: () => load(col),
        stop: () => { if (subs[col]) subs[col].delete(h); }
      };
    }
  };
})();
