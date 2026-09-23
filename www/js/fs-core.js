// ============================================================
// AstroKnot Tablet - fs-core.js  FS 工具层（平板专属）
//
// 统一封装 Capacitor Filesystem 访问，为键值层（system-storage-fs.js）、
// 项目布局层（project-fs-shim.js）、IDE 垫片（ide-fs-shim.js）提供一致的
// 「虚拟路径」原语。所有路径均相对存储根（base）：
//   - 授权（MANAGE_EXTERNAL_STORAGE）→ Directory.Documents/AstroKnot-Data/
//     （/storage/emulated/0/Documents/AstroKnot-Data，USB 可见，与桌面
//       AstroKnot-Data 布局一致：projects/ system/ trash/）
//   - 未授权降级      → Directory.Data/AstroKnot-Data/（应用私有）
//
// 注意: 文本编码必须小写 'utf8'（Capacitor native 大写 UTF8 会报错）
// ============================================================
(function () {
  'use strict';

  var UTF8 = 'utf8';
  var BASE_NAME = 'AstroKnot-Data';

  var FS = function () {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) || null;
  };
  var Perm = function () {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StoragePerm) || null;
  };

  // 根状态：dir 为 Capacitor Directory 常量，base 为根文件夹名
  var state = { dir: 'DATA', base: BASE_NAME, ready: false, fallback: false, native: false };
  // 本会话已确认存在的目录（key = dir:路径），加速 ensureDir 热路径
  var knownDirs = new Set();

  // ---------- 路径规范化：统一 / 分隔，解析 ./ ../（防逃逸） ----------
  function norm(p) {
    if (!p) return '';
    var out = [];
    var segs = String(p).replace(/\\/g, '/').split('/');
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return out.join('/');
  }
  function join(base, name) { return norm(base ? base + '/' + name : name); }
  function basename(p) { var n = norm(p); return n ? n.split('/').pop() : ''; }

  // 虚拟路径 → 根内真实相对路径
  function abs(p) {
    var n = norm(p);
    return n ? state.base + '/' + n : state.base;
  }
  function full(p) { return { path: abs(p), directory: state.dir }; }

  function available() { return !!FS(); }
  function isReady() { return state.ready && !state.fallback && available(); }

  // ---------- 基础原语（全部接受虚拟路径） ----------
  function stat(p) {
    if (!isReady()) return Promise.resolve(null);
    return FS().stat(full(p)).then(function (r) {
      return { isDir: r.type === 'directory', size: r.size || 0, mtime: r.mtime || 0 };
    }).catch(function () { return null; });
  }

  function ensureDir(p) {
    if (!p || !isReady()) return Promise.resolve(false);
    var n = abs(p);
    var cacheKey = state.dir + ':' + n;
    // 桥调用实测 ~96ms/次（低端平板）：本会话已确认存在的目录直接命中缓存，
    // 省掉 mkdir(reject)+stat 共 2 次桥调用。文件写入均为 recursive:true，
    // 目录即使被外部删除也会随写文件自动重建，缓存安全。
    if (knownDirs.has(cacheKey)) return Promise.resolve(true);
    return FS().mkdir({ path: n, directory: state.dir, recursive: true }).then(function () {
      return true;
    }).catch(function (e) {
      // Capacitor mkdir 对已存在目录即使 recursive:true 也会 reject → 验证存在即忽略
      return stat(p).then(function (st) {
        if (st && st.isDir) return true;
        throw e;
      });
    }).then(function (ok) {
      if (ok) knownDirs.add(cacheKey);
      return ok;
    });
  }

  function readText(p) {
    return FS().readFile({ path: abs(p), directory: state.dir, encoding: UTF8 }).then(function (r) { return r.data; });
  }
  function readBase64(p) {
    return FS().readFile({ path: abs(p), directory: state.dir }).then(function (r) { return r.data; });
  }
  function writeText(p, content) {
    return FS().writeFile({ path: abs(p), directory: state.dir, data: String(content == null ? '' : content), encoding: UTF8, recursive: true });
  }
  function writeBase64(p, b64) {
    return FS().writeFile({ path: abs(p), directory: state.dir, data: String(b64 == null ? '' : b64), recursive: true });
  }
  function remove(p) {
    if (!isReady()) return Promise.resolve(false);
    return FS().deleteFile({ path: abs(p), directory: state.dir }).then(function () { return true; })
      .catch(function () { return false; }); // 不存在视为已删
  }

  /** 递归删除（文件/目录均可；不存在静默成功） */
  function rmrf(p) {
    if (!p || !isReady()) return Promise.resolve(false);
    return stat(p).then(function (st) {
      if (!st) return false;
      if (st.isDir) {
        return FS().rmdir({ path: abs(p), directory: state.dir, recursive: true }).then(function () { return true; })
          .catch(function () { return false; });
      }
      return remove(p);
    });
  }

  function rename(from, to) {
    return FS().rename({ from: abs(from), to: abs(to), directory: state.dir, toDirectory: state.dir });
  }

  /** 列目录 → [{name, isDir, size, mtime}]（目录不存在返回 []） */
  function listDir(p) {
    if (!isReady()) return Promise.resolve([]);
    // 桥调用实测 ~96ms/次：去掉前置 stat（readdir 对不存在目录 reject → catch 返回 []，语义一致）
    return FS().readdir({ path: abs(p), directory: state.dir }).then(function (r) {
      var out = [];
      var files = (r && r.files) || [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        out.push({
          name: f.name,
          isDir: f.type === 'directory',
          size: f.size || 0,
          mtime: f.mtime || 0,
        });
      }
      return out;
    }).catch(function () { return []; });
  }

  // ---------- 根解析与权限 ----------
  function nativeStorage() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }

  /** 探测目录可写性：写探测文件后删除 */
  function probe() {
    return writeText('.fs-core-probe', '1')
      .then(function () { return remove('.fs-core-probe'); })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  /**
   * 解析存储根：Documents 优先（授权时），失败/未授权降级 Data。
   * 返回 { dir, base, fallback }（fallback=true 表示浏览器/无原生环境）
   */
  function resolveRoot() {
    if (!nativeStorage() || !available()) {
      state.fallback = true;
      state.ready = true;
      console.warn('[fs-core] 非原生环境或 Filesystem 插件缺失，文件化存储不可用（浏览器降级）');
      return Promise.resolve(state);
    }
    state.native = true;
    var permApi = Perm();
    var checkPerm = permApi && permApi.ensureAccess
      ? permApi.ensureAccess().catch(function () { return { granted: false }; })
      : Promise.resolve({ granted: false });

    return checkPerm.then(function (r) {
      var granted = !!(r && r.granted);
      if (!granted) {
        // 降级应用私有目录；插件已尝试跳转系统授权页（仅首次，见 fs-boot）
        state.dir = 'DATA';
        console.warn('[fs-core] 未授予「所有文件访问」权限，降级应用私有目录');
        return ensureBase();
      }
      // 授权 → 尝试 Documents 真实可写探测
      state.dir = 'DOCUMENTS';
      return ensureBase().then(function () { return probe(); }).then(function (ok) {
        if (!ok) {
          state.dir = 'DATA';
          console.warn('[fs-core] Documents 探测失败，降级应用私有目录');
          return ensureBase();
        }
        console.log('[fs-core] 存储根: /storage/emulated/0/Documents/' + BASE_NAME);
      });
    }).then(function () {
      state.ready = true;
      return state;
    }).catch(function (e) {
      console.error('[fs-core] 根解析失败，回退 Data 目录:', e);
      state.dir = 'DATA';
      state.ready = true;
      return state;
    });
  }

  function ensureBase() {
    return ensureDirBase(state.base).then(function () {
      // 预建桌面同款目录骨架（验证清单要求 ls 可见 projects/ system/ trash/）
      return Promise.all([
        ensureDirBase(state.base + '/projects'),
        ensureDirBase(state.base + '/system'),
        ensureDirBase(state.base + '/system/storage'),
        ensureDirBase(state.base + '/trash'),
      ]);
    }).then(function () {
      // 骨架目录写入 ensureDir 缓存（后续业务 ensureDir 命中零桥调用）
      ['projects', 'system', 'system/storage', 'trash'].forEach(function (rel) {
        knownDirs.add(state.dir + ':' + state.base + '/' + rel);
      });
    });
  }
  // ensureDir 走 abs()（会再拼 base），此处直接用原始相对路径
  function ensureDirBase(relPath) {
    return FS().mkdir({ path: relPath, directory: state.dir, recursive: true }).catch(function (e) {
      return FS().stat({ path: relPath, directory: state.dir }).then(function (r) {
        if (r && r.type === 'directory') return true;
        throw e;
      });
    });
  }

  window.FSCore = {
    dir: function () { return state.dir; },
    base: function () { return state.base; },
    isNative: function () { return state.native; },
    isReady: isReady,
    isFallback: function () { return state.fallback; },
    norm: norm, join: join, basename: basename, abs: abs,
    available: available,
    stat: stat, ensureDir: ensureDir,
    readText: readText, readBase64: readBase64,
    writeText: writeText, writeBase64: writeBase64,
    remove: remove, rmrf: rmrf, rename: rename, listDir: listDir,
    resolveRoot: resolveRoot,
    state: state,
  };

  console.log('[fs-core] FS 工具层已加载');
})();
