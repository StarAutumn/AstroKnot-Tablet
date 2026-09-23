// ============================================================
// AstroKnot Tablet - 版本时间线存储垫片（文件层后端，与桌面 .versiongraph/ 同构）
//
// 桌面语义（main/ipc-version-graph.js）:
//   versionKey = 项目文件夹路径 → <项目文件夹>/.versiongraph/graph.json + blobs/<hash>.json
//   versionKey = 未保存项目 id → <数据根>/system/version-graphs-tmp/<key>/
//   graph.json 带 2 空格缩进；blob 无缩进；内容寻址重复写结果一致
// 平板: folderPath 为根内相对路径（projects/<名>），versionKey 含 '/' 即项目路径；
//   纯 id（无 '/'）视为未保存项目 → system/version-graphs-tmp/<sanitized>/
// 旧 localStorage 数据启动后一次性迁移：写文件成功才清键（数据安全优先）
// 加载顺序：必须在 web-api-shim.js 之后、modules 之前（合并进 window.api）；
//   FSCore 就绪后文件操作可用（waitReady 惰性等待）
// ============================================================
(function () {
  'use strict';

  var GRAPH_PREFIX = 'astroknot_vgraph:';   // 旧 localStorage 键（迁移源）
  var BLOB_PREFIX = 'astroknot_vblob:';
  var TMP_ROOT = 'system/version-graphs-tmp';

  function fsc() { return window.FSCore; }

  /** 等 FSCore 加载并就绪（本垫片加载早于 fs-core.js，需容忍 FSCore 尚未定义） */
  function waitReady() {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      var timer = setInterval(function () {
        var core = fsc();
        if (core && core.isReady()) { clearInterval(timer); resolve(); }
        else if (Date.now() - t0 > 15000) { clearInterval(timer); reject(new Error('FSCore 初始化超时')); }
      }, 50);
    });
  }

  function sanitizeTmpName(s) {
    return String(s).replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 64) || 'unknown';
  }

  /** versionKey → 版本图目录（根内相对路径）。含 '/' = 项目路径；否则未保存项目 tmp（桌面同款分流） */
  function dirsFor(versionKey) {
    var k = String(versionKey || '');
    var base = k.indexOf('/') >= 0 ? k : TMP_ROOT + '/' + sanitizeTmpName(k);
    return { root: base + '/.versiongraph', blobs: base + '/.versiongraph/blobs' };
  }

  var versionApi = {
    versionSaveGraph: function (versionKey, graph) {
      return waitReady().then(function () {
        return fsc().writeText(dirsFor(versionKey).root + '/graph.json', JSON.stringify(graph || {}, null, 2));
      }).then(function () { return { success: true }; })
        .catch(function (e) {
          console.warn('[tablet-version] 保存版本图失败:', e);
          return { success: false, error: e.message };
        });
    },

    versionLoadGraph: function (versionKey) {
      return waitReady().then(function () {
        return fsc().readText(dirsFor(versionKey).root + '/graph.json');
      }).then(function (raw) {
        return { success: true, graph: raw ? JSON.parse(raw) : null };
      }).catch(function () { return { success: true, graph: null }; }); // 文件不存在 = 无版本图
    },

    versionSaveBlob: function (versionKey, hash, content) {
      return waitReady().then(function () {
        return fsc().writeText(dirsFor(versionKey).blobs + '/' + hash + '.json', JSON.stringify(content));
      }).then(function () { return { success: true }; })
        .catch(function (e) { return { success: false, error: e.message }; });
    },

    versionLoadBlob: function (versionKey, hash) {
      return waitReady().then(function () {
        return fsc().readText(dirsFor(versionKey).blobs + '/' + hash + '.json');
      }).then(function (raw) {
        return { success: true, content: raw ? JSON.parse(raw) : null };
      }).catch(function () { return { success: true, content: null }; });
    },

    versionSaveBlobs: function (versionKey, hashToContent) {
      return waitReady().then(function () {
        var jobs = [];
        if (hashToContent) {
          for (var h in hashToContent) {
            if (Object.prototype.hasOwnProperty.call(hashToContent, h)) {
              (function (hash, content) {
                jobs.push(fsc().writeText(dirsFor(versionKey).blobs + '/' + hash + '.json', JSON.stringify(content)));
              })(h, hashToContent[h]);
            }
          }
        }
        return Promise.all(jobs);
      }).then(function () { return { success: true }; })
        .catch(function (e) {
          console.warn('[tablet-version] 批量保存 blob 失败:', e);
          return { success: false, error: e.message };
        });
    },

    versionListGraphs: function () {
      // 桌面同款：仅列未保存项目 tmp 根（已保存项目的版本图随项目文件夹管理）
      return waitReady().then(function () {
        return fsc().listDir(TMP_ROOT);
      }).then(function (items) {
        var jobs = items.filter(function (it) { return it.isDir; }).map(function (dir) {
          return fsc().readText(TMP_ROOT + '/' + dir.name + '/.versiongraph/graph.json').then(function (raw) {
            var g = JSON.parse(raw);
            return {
              dirName: dir.name,
              commitCount: (g.commits || []).length,
              branchCount: (g.branches || []).length,
              lastTime: (g.commits && g.commits.length) ? Math.max.apply(null, g.commits.map(function (c) { return c.time || 0; })) : 0,
            };
          }).catch(function () { return null; });
        });
        return Promise.all(jobs).then(function (list) {
          return { success: true, list: list.filter(Boolean) };
        });
      }).catch(function () { return { success: true, list: [] }; });
    },

    versionDeleteGraph: function (versionKey) {
      return waitReady().then(function () {
        return fsc().rmrf(dirsFor(versionKey).root);
      }).then(function () { return { success: true }; })
        .catch(function (e) {
          console.warn('[tablet-version] 删除版本图失败:', e);
          return { success: false, error: e.message };
        });
    },
  };

  window.api = Object.assign(window.api || {}, versionApi);

  // ── 旧 localStorage 数据一次性迁移（写文件成功才清键，失败保留 localStorage） ──
  // 双重等待：FSCore 文件层就绪 + WebView localStorage 磁盘数据加载完成
  // （Android WebView 的 localStorage 是惰性异步加载的，极早期枚举会拿到空表导致漏迁移）
  // 判定：应用必然有其他持久键（主题/设置等），localStorage.length > 0 即视为已加载
  function waitLocalStorageReady() {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var timer = setInterval(function () {
        var n = 0;
        try { n = localStorage.length; } catch (_) { n = 0; }
        if (n > 0 || Date.now() - t0 > 30000) { clearInterval(timer); resolve(); }
      }, 500);
    });
  }
  function migrateLegacy() {
    waitReady().then(waitLocalStorageReady).then(function () {
      var legacyGraphs = [];
      var legacyBlobs = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf(GRAPH_PREFIX) === 0) legacyGraphs.push(k);
        else if (k.indexOf(BLOB_PREFIX) === 0) legacyBlobs.push(k);
      }
      if (!legacyGraphs.length && !legacyBlobs.length) return;
      var jobs = [];
      legacyGraphs.forEach(function (k) {
        var key = k.slice(GRAPH_PREFIX.length);
        var raw = localStorage.getItem(k);
        if (!raw) return;
        var parsed;
        try { parsed = JSON.parse(raw); } catch (_) { parsed = {}; }
        jobs.push(
          fsc().writeText(dirsFor(key).root + '/graph.json', JSON.stringify(parsed, null, 2))
            .then(function () { localStorage.removeItem(k); })
            .catch(function (e) { console.warn('[tablet-version] 迁移 graph 失败（localStorage 保留）:', key, e); })
        );
      });
      legacyBlobs.forEach(function (k) {
        // 键格式 astroknot_vblob:<versionKey>:<hash>；raw 本就是 JSON.stringify 无缩进，与桌面 blob 格式一致
        var rest = k.slice(BLOB_PREFIX.length);
        var idx = rest.lastIndexOf(':');
        if (idx < 0) return;
        var key = rest.slice(0, idx), hash = rest.slice(idx + 1);
        var raw = localStorage.getItem(k);
        if (!raw) return;
        jobs.push(
          fsc().writeText(dirsFor(key).blobs + '/' + hash + '.json', raw)
            .then(function () { localStorage.removeItem(k); })
            .catch(function (e) { console.warn('[tablet-version] 迁移 blob 失败（localStorage 保留）:', key, hash, e); })
        );
      });
      return Promise.all(jobs).then(function () {
        if (jobs.length) console.log('[tablet-version] 旧 localStorage 版本数据已迁移到 .versiongraph/ 文件层');
      });
    }).catch(function (e) { console.warn('[tablet-version] 迁移调度失败（localStorage 保留）:', e); });
  }
  migrateLegacy();

  console.log('[tablet] 版本时间线存储垫片已加载（文件层后端，桌面 .versiongraph 同构）');
})();
