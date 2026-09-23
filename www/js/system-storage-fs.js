// ============================================================
// AstroKnot Tablet - system-storage-fs.js  键值层垫片（平板专属）
//
// 根因: 桌面 systemStorage.js（modules/systemStorage.js）检测到
//   window.api.systemStorageReadSync 时接管 Storage.prototype，
//   凡 astroknot/knowledge_graph/ai/richEditor/calendar 前缀键全部
//   落到 AstroKnot-Data/system/storage/*.json。平板此前未实现这 4 个
//   同步接口 → _isElectron()=false → 数据滞留 localStorage。
//
// 方案: 启动时把 system/storage/*.json 全部预载进内存 Map，实现 4 个
//   同步接口直查 Map（写操作防抖 300ms 异步落盘）。systemStorage.js
//   在本垫片之后加载（sync-web.mjs 注入顺序保证）→ install() 接管 →
//   设置/日记/便签/应用清单/版本图/ dock 等全部自动文件化，业务零改动。
//
// 文件格式与桌面一致: system/storage/<base64url(key)>.json
//   内容: { key, value, updatedAt }
// ============================================================
(function () {
  'use strict';

  var fsc = window.FSCore;
  var DIR_KEY = 'system/storage';

  var map = new Map();     // key -> value(string)
  var dirty = new Set();   // 待落盘的 key（null 值表示待删除）
  var ready = false;
  var failed = false;
  var flushTimer = 0;
  var flushChain = Promise.resolve();

  // ── 原生 localStorage 直存引用（本垫片先于 systemStorage.js install()
  //    加载，此刻捕获即原生方法；失败降级时必须绕过被接管的 prototype，
  //    否则 systemStorage→垫片→systemStorage 无限递归） ──
  var NATIVE = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    key: Storage.prototype.key,
    length: Object.getOwnPropertyDescriptor(Storage.prototype, 'length'),
  };
  function nativeKeys() {
    var out = [];
    try {
      var len = NATIVE.length.get.call(localStorage);
      for (var i = 0; i < len; i++) {
        var k = NATIVE.key.call(localStorage, i);
        if (k != null) out.push(k);
      }
    } catch (e) { /* 忽略 */ }
    return out;
  }

  // ── 与桌面 systemStorage.js 完全一致的 key 编码 ──
  function encodeKey(key) {
    return window.btoa(encodeURIComponent(key))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  // 仅需解码文件名做诊断时用（读依赖文件内 key 字段，此处不必逆推）
  function filePath(key) { return DIR_KEY + '/' + encodeKey(key) + '.json'; }

  // ── 启动预载：递归读 system/storage/*.json 全部进内存 ──
  function init() {
    if (!fsc.isReady() || !fsc.available()) {
      failed = true;
      ready = true;
      console.warn('[ss-fs] fs-core 不可用，键值层保持 localStorage 模式');
      return Promise.resolve(false);
    }
    return fsc.listDir(DIR_KEY).then(function (items) {
      var jobs = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.isDir || !/\.json$/.test(it.name)) continue;
        jobs.push(
          fsc.readText(DIR_KEY + '/' + it.name).then(function (raw) {
            var obj = JSON.parse(raw);
            if (obj && typeof obj.key === 'string') map.set(obj.key, obj.value);
          }).catch(function (e) {
            console.warn('[ss-fs] 跳过损坏的存储文件:', e && e.message);
          })
        );
      }
      return Promise.all(jobs);
    }).then(function () {
      ready = true;
      console.log('[ss-fs] 键值层预载完成:', map.size, '个键');
      return true;
    }).catch(function (e) {
      failed = true;
      ready = true;
      console.warn('[ss-fs] 预载失败，键值层保持 localStorage 模式:', e);
      return false;
    });
  }

  // ── 落盘：脏键写/删对应文件（串行链防并发交错） ──
  function flush() {
    if (!ready || failed || dirty.size === 0) return Promise.resolve();
    var batch = Array.from(dirty);
    dirty.clear();
    flushChain = flushChain.then(function () {
      var jobs = batch.map(function (key) {
        var value = map.has(key) ? map.get(key) : null;
        var p = filePath(key);
        if (value === null || value === undefined) {
          return fsc.remove(p).catch(function () {});
        }
        var payload = { key: key, value: value, updatedAt: new Date().toISOString() };
        return fsc.writeText(p, JSON.stringify(payload)).catch(function (e) {
          console.warn('[ss-fs] 写盘失败:', key, e);
        });
      });
      return Promise.all(jobs);
    }).catch(function (e) {
      console.warn('[ss-fs] flush 异常:', e);
    });
    return flushChain;
  }
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () {
      flushTimer = 0;
      flush();
    }, 300);
  }

  // ── 同步接口（与桌面 main 进程返回格式一致；失败降级转原生直存，
  //    保持与历史版本完全一致的 localStorage 行为） ──
  function readSync(key) {
    if (failed) {
      var v = NATIVE.getItem.call(localStorage, key);
      return v === null || v === undefined ? { success: false } : { success: true, value: v };
    }
    if (map.has(key)) return { success: true, value: map.get(key) };
    return { success: false };
  }
  function writeSync(key, value) {
    if (failed) {
      try { NATIVE.setItem.call(localStorage, key, String(value)); return { success: true }; }
      catch (e) { return { success: false, error: e.message }; }
    }
    try {
      map.set(key, String(value));
      dirty.add(key);
      scheduleFlush();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  function removeSync(key) {
    if (failed) {
      try { NATIVE.removeItem.call(localStorage, key); } catch (e) { /* 忽略 */ }
      return { success: true };
    }
    if (map.delete(key)) {
      dirty.add(key); // Map 中已无 → flush 时按删除文件处理
      scheduleFlush();
    }
    return { success: true };
  }
  function keysSync() {
    if (failed) return { success: true, keys: nativeKeys() };
    return { success: true, keys: Array.from(map.keys()) };
  }

  // ── 生命周期：退后台/隐藏时强制冲刷未落盘脏键 ──
  function onHidden() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
    flush();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') onHidden();
  });
  window.addEventListener('pagehide', onHidden);

  // ── 挂载 window.api（web-api-shim 之后加载，Object.assign 防覆盖） ──
  if (!window.api) window.api = {};
  Object.assign(window.api, {
    systemStorageReadSync: readSync,
    systemStorageWriteSync: writeSync,
    systemStorageRemoveSync: removeSync,
    systemStorageKeysSync: keysSync,
  });

  window.SystemStorageFs = {
    init: init,
    flush: flush,
    isReady: function () { return ready; },
    isFailed: function () { return failed; },
    getMap: function () { return map; },
    has: function (key) { return map.has(key); },
    get: function (key) { return map.get(key); },
    set: function (key, value) { return writeSync(key, value); },
  };

  console.log('[ss-fs] 键值层垫片已加载');
})();
