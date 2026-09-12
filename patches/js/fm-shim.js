// ============================================================
//  fm-shim.js — 「此 AstroKnot」文件管理器 fm* 接口平板实现
//  对齐桌面 main/ipc-file/file-manager.js 的返回格式（裸对象）。
//  依赖：fs-core.js（原语）、ide-fs-shim.js 的 readAppList（fmFindAppByPath）
// ============================================================
(function () {
  'use strict';
  if (!window.__TABLET__) return;
  var fsc = window.FSCore;
  var api = window.api = window.api || {};

  // 与桌面 fm-read-file 相同的扩展名分类
  var IMAGE_EXTS = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, ico: 1, webp: 1, svg: 1, tiff: 1, tif: 1 };
  var IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', tiff: 'image/tiff', tif: 'image/tiff' };
  var TEXT_EXTS = {
    json: 1, js: 1, mjs: 1, cjs: 1, ts: 1, tsx: 1, jsx: 1, html: 1, htm: 1, css: 1, scss: 1, less: 1,
    md: 1, txt: 1, xml: 1, yaml: 1, yml: 1, sh: 1, bash: 1, zsh: 1, fish: 1, py: 1, rb: 1, go: 1, rs: 1,
    java: 1, c: 1, h: 1, cpp: 1, hpp: 1, cc: 1, cs: 1, php: 1, swift: 1, kt: 1, dart: 1, vue: 1, svelte: 1,
    sql: 1, graphql: 1, toml: 1, ini: 1, cfg: 1, conf: 1, env: 1, gitignore: 1, editorconfig: 1,
    prettierrc: 1, eslintrc: 1, babelrc: 1, stylelintrc: 1
  };
  // 递归跳过巨型/无关目录（IDE 沙盒落盘可能带 node_modules）
  var SKIP_DIRS = { node_modules: 1, '.git': 1, dist: 1, build: 1, '.next': 1, '.nuxt': 1, '.cache': 1 };
  var MAX_TEXT_SIZE = 10 * 1024 * 1024;

  function ext(name) {
    var i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  }

  // ── 目录树（仅目录，递归）──
  function scanTree(rel) {
    return fsc.listDir(rel).then(function (items) {
      var node = { children: {} };
      var chain = Promise.resolve();
      for (var i = 0; i < items.length; i++) {
        (function (it) {
          if (!it.isDir || SKIP_DIRS[it.name]) return;
          chain = chain.then(function () {
            return scanTree(rel ? rel + '/' + it.name : it.name).then(function (child) {
              node.children[it.name] = child;
            });
          });
        })(items[i]);
      }
      return chain.then(function () { return node; });
    }).catch(function () { return { children: {} }; });
  }
  api.fmReadDirTree = function () { return scanTree(''); };

  // ── 列目录 ──
  api.fmReadDir = function (relPath) {
    return fsc.listDir(relPath).then(function (items) {
      return items.map(function (it) {
        return { name: it.name, type: it.isDir ? 'directory' : 'file', size: it.isDir ? 0 : it.size, mtime: it.mtime };
      });
    });
  };

  // ── 读文件（桌面同格式：text/image/binary/directory/error）──
  api.fmReadFile = function (relPath) {
    var e = ext(String(relPath || ''));
    return fsc.stat(relPath).then(function (st) {
      if (!st) return { type: 'error', message: '不存在' };
      if (st.isDir) return { type: 'directory' };
      if (IMAGE_EXTS[e]) {
        return fsc.readBase64(relPath).then(function (b64) {
          var mime = IMAGE_MIME[e] || 'application/octet-stream';
          return { type: 'image', dataUrl: 'data:' + mime + ';base64,' + b64, size: st.size };
        }).catch(function () { return { type: 'error', message: '读取失败' }; });
      }
      if ((TEXT_EXTS[e] || e === '') && st.size <= MAX_TEXT_SIZE) {
        return fsc.readText(relPath).then(function (content) {
          return { type: 'text', content: content, size: st.size };
        }).catch(function () { return { type: 'error', message: '读取失败' }; });
      }
      return { type: 'binary', size: st.size };
    });
  };

  // ── 新建（目录/空文件）──
  api.fmCreateItem = function (relDir, name, itemType) {
    var target = fsc.join(relDir, name);
    return fsc.stat(target).then(function (st) {
      if (st) throw new Error('项目已存在: ' + name);
      if (itemType === 'directory') return fsc.ensureDir(target);
      return fsc.ensureDir(relDir).then(function () {
        return fsc.writeText(target, '');
      });
    }).then(function () { return { success: true }; });
  };

  // ── 删除 ──
  api.fmDeleteItem = function (relPath) {
    return fsc.stat(relPath).then(function (st) {
      if (!st) throw new Error('项目不存在');
      return st.isDir ? fsc.rmrf(relPath) : fsc.remove(relPath);
    }).then(function () { return { success: true }; });
  };

  // ── 重命名 ──
  api.fmRenameItem = function (relPath, newName) {
    var dir = fsc.dirname ? fsc.dirname(relPath) : relPath.replace(/\/[^/]*$/, '');
    var target = fsc.join(dir, newName);
    return fsc.stat(relPath).then(function (st) {
      if (!st) throw new Error('项目不存在');
      return fsc.stat(target).then(function (st2) {
        if (st2) throw new Error('目标名称已存在: ' + newName);
        return fsc.rename(relPath, target);
      });
    }).then(function () { return { success: true }; });
  };

  // ── 复制/剪切 ──
  function copyDeep(srcRel, destRel) {
    return fsc.stat(srcRel).then(function (st) {
      if (!st) throw new Error('源文件不存在');
      if (!st.isDir) {
        return fsc.readBase64(srcRel).then(function (b64) { return fsc.writeBase64(destRel, b64); });
      }
      return fsc.ensureDir(destRel).then(function () {
        return fsc.listDir(srcRel).then(function (items) {
          var chain = Promise.resolve();
          for (var i = 0; i < items.length; i++) {
            (function (it) {
              chain = chain.then(function () {
                return copyDeep(srcRel + '/' + it.name, destRel + '/' + it.name);
              });
            })(items[i]);
          }
          return chain;
        });
      });
    });
  }
  api.fmCopyItem = function (srcRelPath, destRelDir, destName, isMove) {
    var dest = fsc.join(destRelDir, destName);
    return fsc.stat(dest).then(function (st) {
      // 桌面允许覆盖同名？桌面直接 rename/copy 覆盖。平板保持覆盖语义（先删后写）
      if (st) return fsc.rmrf(dest);
      return null;
    }).then(function () {
      if (isMove) {
        return fsc.rename(srcRelPath, dest).then(function (okMove) {
          if (!okMove) {
            // 跨根 rename 失败 → 深拷贝 + 删源
            return copyDeep(srcRelPath, dest).then(function () { return fsc.rmrf(srcRelPath); });
          }
          return null;
        });
      }
      return copyDeep(srcRelPath, dest);
    }).then(function () { return { success: true }; });
  };

  // ── 路径反查所属应用（apps/<appId>/... 才有）──
  api.fmFindAppByPath = function (relPath) {
    try {
      var parts = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/');
      if (parts.length < 2 || parts[0] !== 'apps') return Promise.resolve(null);
      var appId = parts[1];
      return window.api.readAppList().then(function (r) {
        var app = null;
        for (var i = 0; i < ((r && r.apps) || []).length; i++) {
          if (r.apps[i].id === appId) { app = r.apps[i]; break; }
        }
        if (!app) return null;
        return fsc.stat('apps/' + appId + '/sandbox').then(function (st) {
          if (!st) return null;
          return Object.assign({}, app, { sandboxPath: 'apps/' + appId + '/sandbox' });
        });
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  };
})();
