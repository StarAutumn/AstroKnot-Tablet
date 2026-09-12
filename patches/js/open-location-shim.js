// ============================================================
//  open-location-shim.js — 「📂 打开文件所在位置」平板实现
//  平板优先「此 AstroKnot」（builtin-file-manager）应用内定位（自动导航到目录），
//  应用不可用时回退 StoragePerm.openPath（系统文件管理器，对应桌面 shell.showItemInFolder）。
//  依赖：fs-core.js（根解析/路径拼接）、project-fs-shim.js（getNodeFolderName）、
//        ide-fs-shim.js（readAppList）、fm-shim.js（fm* 接口）
// ============================================================
(function () {
  'use strict';
  if (!window.__TABLET__) return;

  var fsc = window.FSCore;
  var api = window.api = window.api || {};

  /** 根内相对路径（fm 接口统一语义，fs-core.abs 可直接解析） */
  function toRel(p) {
    return fsc.norm(String(p || '').replace(/\\/g, '/'));
  }

  function pickFmApp(list) {
    var apps = (list && list.apps) || [];
    for (var i = 0; i < apps.length; i++) {
      if (apps[i].id === 'builtin-file-manager') return apps[i];
    }
    return null;
  }

  /** readAppList 同步/Promise 双兼容 */
  function findFmApp(cb) {
    try {
      var r = window.api.readAppList();
      if (r && typeof r.then === 'function') {
        r.then(function (list) { cb(pickFmApp(list)); }).catch(function () { cb(null); });
      } else {
        cb(pickFmApp(r));
      }
    } catch (e) { cb(null); }
  }

  /** 系统文件管理器回退 */
  function nativeOpen(absPath) {
    var Perm = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StoragePerm;
    if (!Perm || typeof Perm.openPath !== 'function') {
      return Promise.resolve({ success: false, error: 'native 插件不可用' });
    }
    return Perm.openPath({ path: absPath }).catch(function (e) {
      return { success: false, error: (e && e.message) || String(e) };
    });
  }

  /**
   * 应用内定位核心：优先在「此 AstroKnot」窗口中导航到 relDir。
   * - 窗口已开：直接 _navigateTo + AppRunner.bringToFront（open 内处理）
   * - 未开：注入 __fmStartPath，FileManagerApp 构造时导航（sync-web 裁剪补丁）
   */
  function openLocation(relDir) {
    relDir = toRel(relDir);
    if (!relDir) relDir = '';
    return new Promise(function (resolve) {
      findFmApp(function (app) {
        if (!window.AppRunner || typeof window.AppRunner.open !== 'function' || !app) {
          resolve(nativeOpen(fsc.abs(relDir)));
          return;
        }
        var reuse = window.__fmInstance &&
          window.AppRunner._windows && window.AppRunner._windows.has('builtin-file-manager');
        window.__fmStartPath = relDir;
        var nav = (reuse && typeof window.__fmInstance._navigateTo === 'function')
          ? Promise.resolve(window.__fmInstance._navigateTo(relDir)) : Promise.resolve();
        nav.then(function () { return window.AppRunner.open(app); }).then(function () {
          window.__fmStartPath = null;
          resolve({ success: true, inApp: true });
        }).catch(function () {
          resolve(nativeOpen(fsc.abs(relDir)));
        });
      });
    });
  }

  function nodeFolderName(node) {
    var pfs = window.ProjectFsShim;
    if (pfs && typeof pfs.getNodeFolderName === 'function') {
      return pfs.getNodeFolderName(node);
    }
    // 兜底（与 project-fs-shim 同规则）：安全名_id前8字符
    var name = String((node && node.name) || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    return (name || '未知节点') + '_' + String((node && node.id) || '').slice(0, 8);
  }

  // 通用入口（项目列表/富文本附件/Dock/IDE/file-manager 内部 均走这里）
  api.showFileInFolder = function (p) {
    var rel = toRel(p);
    if (!rel) return Promise.resolve({ success: false, error: '缺少路径' });
    // showItemInFolder 语义：定位到所在目录
    var relDir = rel.indexOf('/') >= 0 ? rel.replace(/\/[^/]*$/, '') : '';
    return openLocation(relDir);
  };

  // 文件管理器：相对路径解析（桌面为绝对路径；平板统一为根内相对，
  // 供 readProjectFromFolder / showFileInFolder 等 fs-core 体系直接消费）
  api.fmResolvePath = function (rel) {
    try { return Promise.resolve(toRel(rel)); } catch (e) { return Promise.resolve(null); }
  };

  // 节点右键菜单：定位 <项目>/nodes/<安全名_id前8>/（node-context-menu.js）
  api.showNodeFolder = function (projectFolderPath, node) {
    if (!node) return Promise.resolve({ success: false, error: '缺少参数' });
    var base = String(projectFolderPath || '').replace(/\/+$/, '');
    var nodeDir = base + '/nodes/' + nodeFolderName(node);
    return fsc.stat(nodeDir).then(function (st) {
      if (st) return openLocation(nodeDir);
      // 文件夹不存在 → 定位到 nodes 目录（与桌面一致）
      return fsc.stat(base + '/nodes').then(function (st2) {
        if (st2) return openLocation(base + '/nodes');
        return { success: false, error: 'not_found' };
      });
    }).catch(function (e) {
      return { success: false, error: (e && e.message) || String(e) };
    });
  };

  // IDE 沙盒文件定位（桌面 show-sandbox-file-in-folder 同语义）
  api.showSandboxFileInFolder = function (projectFolderPath, nodeId, vfsPath) {
    var rel = String(vfsPath || '').replace(/^\//, '');
    var candidates = [];
    var base = String(projectFolderPath || '').replace(/\/+$/, '');
    if (base) {
      // 项目已落盘：桌面语义 nodes/<id>/sandbox；平板 IDE 会话沙盒 sandbox-tmp/<id>/sandbox
      candidates.push(base + '/nodes/' + nodeId + '/sandbox');
      candidates.push(base + '/sandbox-tmp/' + nodeId + '/sandbox');
    }
    candidates.push('sandbox-tmp/' + nodeId + '/sandbox');
    var tryOne = function (i) {
      if (i >= candidates.length) {
        return Promise.resolve({ success: false, error: 'Sandbox 目录不存在，请先保存文件' });
      }
      var dir = candidates[i];
      var target = rel ? dir + '/' + rel : dir;
      return fsc.stat(target).then(function (st) {
        if (st) return openLocation(dir);
        return fsc.stat(dir).then(function (st2) {
          if (st2) return openLocation(dir);
          return tryOne(i + 1);
        });
      });
    };
    return tryOne(0);
  };

  // 快速笔记定位：清单 quicknotes.json 中找笔记 folder → quicknotes/<folder>（笔记已文件化，桌面 show-quicknote-in-folder 同语义）
  api.showQuickNoteInFolder = function (data) {
    var noteId = data ? data.noteId : null;
    var QN_ROOT = 'quicknotes';
    return fsc.stat(QN_ROOT).then(function (st) {
      if (!st || !st.isDir) return { success: false, error: 'not_found' };
      if (!noteId) return openLocation(QN_ROOT);
      return fsc.readText(QN_ROOT + '/quicknotes.json').then(function (raw) {
        var meta = [];
        try { meta = JSON.parse(raw); } catch (_) { meta = []; }
        var entry = null;
        for (var i = 0; i < meta.length; i++) { if (meta[i].id === noteId) { entry = meta[i]; break; } }
        var folder = entry ? (entry.folder || entry.id) : null;
        if (!folder) return openLocation(QN_ROOT);
        return fsc.stat(QN_ROOT + '/' + folder).then(function (st2) {
          if (st2) return openLocation(QN_ROOT + '/' + folder);
          return openLocation(QN_ROOT);
        });
      }).catch(function () { return openLocation(QN_ROOT); });
    });
  };
})();
