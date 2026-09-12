// ============================================================
// AstroKnot Tablet - github-read-shim.js  免 git 的 GitHub 仓库读取（平板专属）
//
// 背景：桌面「从 GitHub 导入应用」走 Electron 主进程 spawn 本机 git 命令行
//       （main/ipc-file/ide-fs.js 的 git-clone-and-read），平板 WebView 无
//       git/Node 也无法执行系统命令，功能整体不可用。
//
// 方案演进：
//   ✗ zip 下载（codeload.github.com）→ WebView fetch 必败：codeload 响应
//     无 Access-Control-Allow-Origin 头，https://localhost 源跨域被 CORS 拦截
//   ✓ 复用桌面 GithubApiClient（纯 HTTP，全 CORS 友好）：
//       fetchRepoMeta → api.github.com/repos（ACAO:*，取 default_branch）
//       fetchTree     → api.github.com git/trees?recursive=1（ACAO:*，含
//                       truncated/5000 文件数校验；.git 不入 git 树天然无）
//       filterTree    → 跳过 node_modules/.git/dist 等 + 10MB 单文件限制
//       fetchFile     → raw.githubusercontent.com（ACAO:*，binary 已转 base64）
//       _runPool      → 6 并发限流
//     返回格式与桌面 gitCloneAndRead 一致：
//       { success: true, files: [{ path, content, isBinary }] }
//
// 补齐接口（AppManager/AppRunner 外部应用链路，桌面源码零改动）：
//   window.__githubReadFiles(owner, repo, ref)
//   window.api.gitCloneAndRead(repoUrl)    → 兼容入口（url 自解析）
//   window.api.syncAppDirectory(appId, fs) → VFS 树落盘 apps/<id>/vfs.json
//   window.api.readAppSandbox(appId)       → 读回 VFS 树（AppRunner srcdoc 回退用）
//   window.api.getAppSandboxPath(appId)    → 恒 null（AppRunner 自动走 VFS 内联回退，
//                                             无需 findAppEntryHtml/startAppServer）
// 依赖：fs-core.js（AstroKnot-Data 根写入）、加载顺序在 fm-shim.js 之后
// ============================================================
(function () {
  'use strict';
  if (!window.__TABLET__) return;

  var MAX_FILE = 10 * 1024 * 1024; // 单文件 10MB（与 GithubClient._maxFileSize 一致）

  /** 主入口：owner/repo → {success, files:[{path, content, isBinary}]}（对齐桌面 gitCloneAndRead） */
  window.__githubReadFiles = async function (owner, repo, ref) {
    var m = await import('/modules/AppLibrary/ide/core/github-api.js');
    var client = new m.GithubApiClient();

    var r = (ref || '').trim();
    if (!r) {
      var meta = await client.fetchRepoMeta(owner, repo);
      r = meta.defaultBranch || 'main';
    }

    var tree = await client.fetchTree(owner, repo, r);
    var filtered = client.filterTree(tree, MAX_FILE);
    if (filtered.skipped.length) {
      console.warn('[github-http] 跳过 ' + filtered.skipped.length + ' 个文件（node_modules 等目录/超 10MB）:',
        filtered.skipped.slice(0, 10).map(function (s) { return s.path; }).join(', '));
    }

    var files = [];
    var res = await client._runPool(filtered.kept, async function (item) {
      var f = await client.fetchFile(owner, repo, r, item.path);
      files.push({ path: item.path, content: f.content, isBinary: f.isBinary });
    }, null, null);
    if (res.failed.length) {
      console.warn('[github-http] ' + res.failed.length + ' 个文件下载失败（已跳过）:',
        res.failed.slice(0, 10).map(function (f) { return f.item.path + ': ' + f.error; }).join('; '));
    }
    return { success: true, files: files };
  };

  // ── 补齐 window.api（ide-fs-shim 已 merge window.api，这里追加）──
  var fsc = window.FSCore;
  window.api = window.api || {};

  // 兼容入口：解析 repoUrl 后走 HTTP 树拉取
  window.api.gitCloneAndRead = async function (repoUrl) {
    var m = /github\.com[\/:]([^\/]+)\/([^\/]+?)(?:\.git)?\/?$/.exec(String(repoUrl || ''));
    if (!m) throw new Error('无法解析仓库地址: ' + repoUrl);
    return window.__githubReadFiles(m[1], m[2], '');
  };

  // VFS 树落盘：apps/<appId>/vfs.json（AstroKnot-Data 根，与桌面 apps/ 同构）
  // diskPath 恒 null → AppManager 自动跳过 npm install / 图标检测（平板无 npm）
  window.api.syncAppDirectory = async function (appId, fileSystem) {
    if (!fsc) return { success: false, error: '文件系统不可用' };
    try {
      await fsc.ensureDir('apps/' + appId);
      await fsc.writeText('apps/' + appId + '/vfs.json', JSON.stringify(fileSystem));
      return { success: true, diskPath: null };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  // 读回 VFS 树（AppRunner._openNormalApp 的 VFS 内联回退分支消费）
  window.api.readAppSandbox = async function (appId) {
    if (!fsc) return null;
    try {
      var t = await fsc.readText('apps/' + appId + '/vfs.json');
      return JSON.parse(t);
    } catch (e) {
      return null;
    }
  };

  // 恒 null：AppRunner 678 行 if (sandboxPath) 为假 → 走 readAppSandbox srcdoc 回退
  window.api.getAppSandboxPath = async function () { return null; };

  // 删除应用：清掉 apps/<appId>/（AppManager.deleteApp 调用，不检查返回值）
  window.api.deleteApp = async function (appId) {
    if (!fsc) return { success: false };
    try {
      await fsc.rmrf('apps/' + appId);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };

  console.log('[tablet] GitHub HTTP 导入垫片已加载（git trees + raw，全 CORS 友好）');
})();
