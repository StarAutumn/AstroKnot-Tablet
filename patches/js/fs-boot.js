// ============================================================
// AstroKnot Tablet - fs-boot.js  启动编排（平板专属）
//
// 职责（全部完成后 resolve window.__storageReady，业务模块经
// index.html 注入的 module 门闩 await 后才启动 → 杜绝早期空读）:
//   1. 同步快照原生 localStorage（本脚本先于 systemStorage.js 加载，
//      install() 尚未接管 → 快照即迁移数据源；localStorage 永不删除，
//      作为数据安全备份）
//   2. 根解析（Documents 优先，未授权降级 Data 并首次引导授权页）
//   3. 键值层预载（system/storage/*.json → Map）
//   4. 一次性迁移（标记键 astroknot_fs_migrated 不存在时）:
//      a) 旧根(Data) → 新根 upgrade 合并（授权后升级场景）
//      b) localStorage app 前缀键 → system/storage/*.json
//      c) astroknot_web_projects 大 JSON → projects/<名>/project.json
//      d) astroknot_web_trash → trash/<名>/ + .trash-meta.json
//   5. 项目层预载（扫 projects/*/project.json）
//   6. 回退: 任一步失败 → 删除文件化接口回退 localStorage 模式（不崩）
//   7. 会话中授权升级: 退后台→授权→回前台时自动切 Documents 并补迁
// ============================================================
(function () {
  'use strict';

  var fsc = window.FSCore;
  var ssf = window.SystemStorageFs;
  var pfs = window.ProjectFsShim;

  // ── 迁移标记（与桌面 systemStorage 键同空间文件化） ──
  var MIGRATED_KEY = 'astroknot_fs_migrated';
  var PERM_PROMPTED_KEY = 'astroknot_perm_prompted';

  // 与桌面 modules/systemStorage.js APP_KEY_PREFIXES 保持一致
  var APP_KEY_PREFIXES = ['astroknot', 'knowledge_graph', 'ai', 'richEditor', 'calendar', 'sandbox-ide-settings', 'qnotes_migrated'];
  // 已被 projects/ trash/ 文件夹取代的大 JSON 键，不复制进键值层（localStorage 原样保留作备份）
  var MIGRATION_EXCLUDED = ['astroknot_web_projects', 'astroknot_web_trash'];

  function isAppKey(key) {
    if (!key) return false;
    for (var i = 0; i < APP_KEY_PREFIXES.length; i++) {
      if (key.indexOf(APP_KEY_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  // ── 1. 同步快照原生 localStorage（此刻 install() 尚未接管） ──
  function snapshotNativeLocalStorage() {
    var out = {};
    try {
      var len = localStorage.length;
      for (var i = 0; i < len; i++) {
        var k = localStorage.key(i);
        if (k == null) continue;
        try { out[k] = localStorage.getItem(k); } catch (e) { /* 跳过坏键 */ }
      }
    } catch (e) {
      console.warn('[fs-boot] localStorage 快照失败:', e);
    }
    return out;
  }
  var nativeSnapshot = snapshotNativeLocalStorage();

  // ── 失败回退：摘除文件化接口（键值层自身转原生直写） ──
  function degradeToLocalStorageMode(reason) {
    console.warn('[fs-boot] 回退 localStorage 模式:', reason);
    if (window.api) {
      ['moveProjectToTrash', 'listTrash', 'restoreFromTrash', 'permanentlyDeleteTrashItem',
        'emptyTrash', 'deleteProjectFolder', 'deleteSandboxTmpFolder',
        'readProjectFromFolder', 'loadProjectFromFolder'].forEach(function (k) {
          delete window.api[k];
        });
    }
    if (pfs) pfs._degraded = true;
  }

  // ── 4a. 旧根(Data)内容 → 当前根 upgrade 合并（fill-missing，不覆盖） ──
  function mergeFromOldDataRoot() {
    if (fsc.dir() !== 'DOCUMENTS') return Promise.resolve(); // 仅授权升级时需要
    var oldDir = 'DATA';
    var FS = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!FS) return Promise.resolve();

    function oldList(p) {
      return FS.readdir({ path: p, directory: oldDir }).then(function (r) { return r.files || []; }).catch(function () { return []; });
    }
    function oldReadText(p) {
      return FS.readFile({ path: p, directory: oldDir, encoding: 'utf8' }).then(function (r) { return r.data; });
    }
    function copyMissing(oldRel, newRel) {
      return FS.stat({ path: oldRel, directory: oldDir }).then(function (st) {
        return fsc.stat(newRel).then(function (newSt) {
          if (newSt) return; // 新根已有 → 跳过（新根优先）
          if (st.type === 'directory') {
            return fsc.ensureDir(newRel).then(function () {
              return oldList(oldRel).then(function (files) {
                return Promise.all(files.map(function (f) {
                  return copyMissing(oldRel + '/' + f.name, fsc.join(newRel, f.name));
                }));
              });
            });
          }
          return FS.readFile({ path: oldRel, directory: oldDir }).then(function (r) {
            return fsc.writeBase64(newRel, r.data);
          });
        });
      }).catch(function () { /* 旧根条目缺失忽略 */ });
    }

    return oldList('AstroKnot-Data/system/storage').then(function (files) {
      // 旧根键值文件 → Map fill-missing（内存已在的更新值不覆盖）
      return Promise.all(files.map(function (f) {
        if (f.type === 'directory' || !/\.json$/.test(f.name)) return null;
        return oldReadText('AstroKnot-Data/system/storage/' + f.name).then(function (raw) {
          var obj = JSON.parse(raw);
          if (obj && typeof obj.key === 'string' && !ssf.getMap().has(obj.key)) {
            ssf.getMap().set(obj.key, obj.value);
          }
        }).catch(function () {});
      }));
    }).then(function () {
      // 旧根项目/回收站文件夹 → 新根（fill-missing）
      return Promise.all(['projects', 'trash'].map(function (seg) {
        return oldList('AstroKnot-Data/' + seg).then(function (dirs) {
          return Promise.all(dirs.map(function (d) {
            if (d.type !== 'directory') return null;
            return copyMissing('AstroKnot-Data/' + seg + '/' + d.name, seg + '/' + d.name);
          }));
        });
      }));
    }).catch(function (e) {
      console.warn('[fs-boot] 旧根合并跳过:', e);
    });
  }

  // ── 4b/4c/4d. localStorage → 文件（fill-missing 语义） ──
  function migrateFromLocalStorage() {
    var jobs = [];

    // b) app 前缀键 → 键值层
    Object.keys(nativeSnapshot).forEach(function (k) {
      if (!isAppKey(k)) return;
      if (MIGRATION_EXCLUDED.indexOf(k) >= 0) return;
      var v = nativeSnapshot[k];
      if (v == null) return;
      if (!ssf.getMap().has(k)) ssf.set(k, v); // 走 set → 进 Map + 防抖落盘
    });

    // c) 项目大 JSON → projects/<名>/project.json
    var rawProjects = nativeSnapshot['astroknot_web_projects'];
    if (rawProjects) {
      try {
        var list = JSON.parse(rawProjects);
        if (Array.isArray(list)) {
          list.forEach(function (p) {
            if (!p || !p.data || !p.data.methodsTree) return;
            var folder = 'projects/' + pfs.sanitizeProjectFolderName(p.name);
            jobs.push(
              fsc.stat(fsc.join(folder, 'project.json')).then(function (st) {
                if (st) return; // 已有 → 跳过（升级合并优先）
                return pfs.writeProjectToDisk(folder, pfs.buildProjectData(p));
              }).catch(function (e) {
                console.warn('[fs-boot] 项目迁移失败:', p.name, e);
              })
            );
          });
        }
      } catch (e) {
        console.warn('[fs-boot] astroknot_web_projects 解析失败:', e);
      }
    }

    // d) 回收站大 JSON → trash/<名>/
    var rawTrash = nativeSnapshot['astroknot_web_trash'];
    if (rawTrash) {
      try {
        var trash = JSON.parse(rawTrash);
        if (Array.isArray(trash)) {
          trash.forEach(function (item, idx) {
            if (!item || !item.data) return;
            var folder = 'trash/' + pfs.sanitizeProjectFolderName(item.name || '未命名项目') + '_' + Date.now() + '_' + idx;
            jobs.push(
              fsc.stat(folder).then(function (st) {
                if (st) return;
                return pfs.writeProjectToDisk(folder, pfs.buildProjectData(item)).then(function () {
                  var meta = {
                    projectId: item.id || null,
                    projectName: item.name || '未命名项目',
                    originalPath: item.folderPath || null,
                    deletedAt: item.deletedAt || new Date().toISOString(),
                    wasUnsaved: !item.folderPath,
                  };
                  return fsc.writeText(fsc.join(folder, '.trash-meta.json'), JSON.stringify(meta, null, 2));
                });
              }).catch(function (e) {
                console.warn('[fs-boot] 回收站迁移失败:', item.name, e);
              })
            );
          });
        }
      } catch (e) {
        console.warn('[fs-boot] astroknot_web_trash 解析失败:', e);
      }
    }

    return Promise.all(jobs).then(function () {
      return ssf.flush(); // 键值层脏键一次性落盘
    });
  }

  // ── 7. 会话中授权升级：回前台时未授权→已授权 → 切 Documents + 补迁 ──
  function setupResumeUpgrade() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (fsc.dir() !== 'DATA' || !fsc.isNative() || !fsc.available()) return;
      var Perm = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StoragePerm;
      if (!Perm || !Perm.ensureAccess) return;
      Perm.ensureAccess({ openSettings: false }).then(function (r) {
        if (!r || !r.granted) return;
        // 授权到手：冲刷当前根 → 切 DOCUMENTS → ensureBase → 补迁 → 预载刷新
        ssf.flush().then(function () {
          return pfs.flushSave();
        }).then(function () {
          fsc.state.dir = 'DOCUMENTS';
          console.log('[fs-boot] 会话中已授权，存储根切换至 Documents');
          return mergeFromOldDataRoot();
        }).then(function () {
          return migrateFromLocalStorage();
        }).then(function () {
          // 写标记（当前根）
          ssf.set(MIGRATED_KEY, JSON.stringify({ at: new Date().toISOString(), version: 1 }));
          return ssf.flush();
        }).then(function () {
          return pfs.init(); // 重新扫项目清单
        }).catch(function (e) {
          console.warn('[fs-boot] 会话中升级失败:', e);
        });
      }).catch(function () {});
    });
  }

  // ── 门闩：同步赋值（module 脚本按文档序等待本 Promise） ──
  window.__storageReady = (async function () {
    try {
      // 2. 根解析（未授权时首次引导授权页）
      var prompted = false;
      try { prompted = !!localStorage.getItem(PERM_PROMPTED_KEY); } catch (e) { /* 忽略 */ }
      var Perm = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StoragePerm;
      var granted = false;
      if (Perm && Perm.ensureAccess) {
        try {
          var r = await Perm.ensureAccess({ openSettings: !prompted });
          granted = !!(r && r.granted);
        } catch (e) { granted = false; }
        try { localStorage.setItem(PERM_PROMPTED_KEY, '1'); } catch (e) { /* 忽略 */ }
      }
      await fsc.resolveRoot();
      console.log('[fs-boot] 存储根就绪:', fsc.dir() === 'DOCUMENTS'
        ? '/storage/emulated/0/Documents/AstroKnot-Data'
        : '(应用私有) Data/AstroKnot-Data', granted ? '[已授权]' : '[未授权降级]');

      // 3. 键值层预载
      var kvOk = await ssf.init();
      if (!kvOk) { degradeToLocalStorageMode('键值层预载失败'); return; }

      // 4. 一次性迁移
      if (!ssf.getMap().has(MIGRATED_KEY)) {
        console.log('[fs-boot] 首次文件化：开始迁移 localStorage 数据 …');
        await mergeFromOldDataRoot();
        await migrateFromLocalStorage();
        ssf.set(MIGRATED_KEY, JSON.stringify({ at: new Date().toISOString(), version: 1 }));
        await ssf.flush();
        console.log('[fs-boot] 迁移完成（localStorage 已原样保留作备份）');
      }

      // 5. 项目层预载
      var pjOk = await pfs.init();
      if (!pjOk) { degradeToLocalStorageMode('项目层预载失败'); return; }

      // 7. 会话中授权升级监听
      setupResumeUpgrade();
      console.log('[fs-boot] 文件化存储就绪 ✓');
    } catch (e) {
      console.error('[fs-boot] 初始化异常，回退 localStorage 模式:', e);
      degradeToLocalStorageMode(e && e.message);
    }
  })();

  console.log('[fs-boot] 启动编排已挂载（__storageReady 已发布）');
})();
