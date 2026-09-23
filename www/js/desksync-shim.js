// ============================================================
// AstroKnot Tablet - desksync-shim.js  从桌面同步（平板专属，配对码模式）
//
// 背景：桌面端「移动端同步」已改为配对码模式——桌面用户自设持久配对码，
//       服务常驻监听（8899 起）。平板复用 GitHub 同步弹窗标题栏 📱 按钮，
//       由桌面 mobile-sync.js 的 window.__TABLET__ 分支调到本垫片，
//       提供「输入 地址+配对码 → 拉项目列表 → 下载 tgz → 解压落盘」消费端。
//
// 流程: 输入 host + 配对码（conn 持久化 localStorage，持续配对）
//       → GET /api/info?t=配对码  拉项目列表
//       → GET /api/project?dir=..&t=..  下载 tgz
//       → DecompressionStream gunzip + 自研 tar 解析（移植手机版 github.js）
//       → 仅保留 project.json / project.md / nodes/**（跳 .versiongraph）
//       → FSCore 写入 AstroKnot-Data/projects/<dir>/（桌面同构布局）
//       → ProjectFsShim.registerExternalProject 注册清单 + appState.projects.push
//
// HTTP: 原生优先 CapacitorHttp（无 CORS/混合内容限制），fetch 回退
//       （桌面响应已带 Access-Control-Allow-Origin:*，平板 allowMixedContent:true）
// 依赖: fs-core.js（FSCore）、project-fs-shim.js（ProjectFsShim），加载在其后
// ============================================================
(function () {
  'use strict';
  if (!window.__TABLET__) return;

  var CONN_KEY = 'astroknot_desksync_conn';
  var BINARY_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'mp4', 'webm', 'mov',
    'woff', 'woff2', 'ttf', 'otf', 'eot', 'zip', 'gz', '7z', 'pdf']);

  var _overlay = null;
  var currentConn = null;   // { host, token }
  var lastProjects = [];    // 最近一次获取的项目列表
  var rowBtns = new Map();  // dir -> 行内导入按钮
  var syncingAll = false;

  // ── conn 持久化 ──
  function loadConn() {
    try {
      var raw = localStorage.getItem(CONN_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      return (c && c.host && c.token) ? c : null;
    } catch (_) { return null; }
  }
  function saveConn(conn) {
    try { localStorage.setItem(CONN_KEY, JSON.stringify(conn)); } catch (_) { /* 存储满等 */ }
  }

  // ── HTTP（原生走 CapacitorHttp 无 CORS 限制；回退 fetch） ──
  function capHttp() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
  }
  function reqUrl(conn, path) {
    return 'http://' + conn.host + path + (path.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(conn.token);
  }
  function bytesFromCapacitorData(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') { // CapacitorHttp arrayBuffer 返回 base64 字符串
      var bin = atob(data);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (data && data.buffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
    throw new Error('未知的响应数据类型: ' + typeof data);
  }
  async function httpGetJson(conn, path) {
    var url = reqUrl(conn, path);
    var http = capHttp();
    if (http) {
      var r = await http.get({ url: url, responseType: 'json' });
      var d = r.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { d = {}; } }
      if (r.status !== 200) throw new Error('HTTP ' + r.status + (d && d.error ? '：' + d.error : ''));
      return d;
    }
    var resp = await fetch(url);
    var body = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(body.error || 'HTTP ' + resp.status);
    return body;
  }
  async function httpGetBytes(conn, path) {
    var url = reqUrl(conn, path);
    var http = capHttp();
    if (http) {
      var r = await http.get({ url: url, responseType: 'arrayBuffer' });
      if (r.status !== 200) {
        var msg = 'HTTP ' + r.status;
        if (r.data && typeof r.data === 'string') { try { msg = JSON.parse(r.data).error || msg; } catch (_) {} }
        throw new Error(msg + (r.status === 401 ? '' : '（项目可能正在被修改，请重试）'));
      }
      return bytesFromCapacitorData(r.data);
    }
    var resp = await fetch(url);
    if (!resp.ok) {
      var m = 'HTTP ' + resp.status;
      try { m = (await resp.json()).error || m; } catch (_) { /* 非 JSON */ }
      throw new Error(m);
    }
    return new Uint8Array(await resp.arrayBuffer());
  }

  // ── gunzip（DecompressionStream） ──
  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前 WebView 不支持 DecompressionStream，无法解压');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ── tar 解析（支持 ustar prefix 与 GNU longname，跳过 pax 头；移植手机版） ──
  function tarStr(bytes, off, len) {
    var end = off, max = off + len;
    while (end < max && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(off, end));
  }
  function tarOctal(bytes, off, len) {
    var s = tarStr(bytes, off, len).replace(/[\s\0]/g, '');
    if (!s) return 0;
    return parseInt(s, 8) || 0;
  }
  function parseTar(bytes) {
    var entries = [], off = 0, longName = null;
    while (off + 512 <= bytes.length) {
      var header = bytes.subarray(off, off + 512);
      var allZero = true;
      for (var z = 0; z < 512; z++) { if (header[z] !== 0) { allZero = false; break; } }
      if (allZero) break;
      var size = tarOctal(header, 124, 12);
      var type = String.fromCharCode(header[156] || 48);
      off += 512;
      var data = bytes.subarray(off, off + size);
      off += Math.ceil(size / 512) * 512;
      if (type === 'L') { longName = tarStr(data, 0, size); continue; } // GNU longname
      if (type === 'x' || type === 'g') continue;                       // pax 头（简化跳过）
      var name = tarStr(header, 0, 100);
      var prefix = tarStr(header, 345, 155);
      var path = longName || (prefix ? prefix + '/' + name : name);
      longName = null;
      path = path.replace(/\/+$/, '');
      if (!path) continue;
      if (type === '5') entries.push({ path: path, dir: true, data: null });
      else if (type === '0' || type === '\0') entries.push({ path: path, dir: false, data: data });
    }
    return entries;
  }

  // ── 提取 AstroKnot 项目（移植手机版 github.js） ──
  function extOf(path) {
    var m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }
  /** 找 project.json 所在的项目根（取路径段最少的那个） */
  function findProjectRoot(entries) {
    var best = null;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.dir || e.path.split('/').pop() !== 'project.json') continue;
      var segs = e.path.split('/');
      if (!best || segs.length < best.length) best = segs;
    }
    return best ? best.slice(0, -1) : null;
  }
  /** 按项目根裁剪路径 + 过滤保留范围 */
  function collectProjectFiles(entries, rootSegs) {
    var rootLen = rootSegs ? rootSegs.length : 0;
    var files = {};   // relPath -> Uint8Array
    var skippedVersionGraph = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.dir) continue;
      var segs = e.path.split('/');
      if (segs.length <= rootLen) continue;
      var rel = segs.slice(rootLen).join('/');
      if (segs.indexOf('.versiongraph') >= 0) { skippedVersionGraph++; continue; }
      var top = segs[rootLen];
      if (top === 'project.json' || top === 'project.md' || top === 'nodes') {
        files[rel] = e.data;
      }
      // 其余顶层内容（settings 等）不保留
    }
    return { files: files, skippedVersionGraph: skippedVersionGraph };
  }
  function parseProjectJson(files) {
    var pj = files['project.json'];
    if (!pj) throw new Error('压缩包中没有找到 project.json，不是 AstroKnot 项目');
    var data;
    try {
      data = JSON.parse(new TextDecoder().decode(pj));
    } catch (e) {
      throw new Error('project.json 解析失败: ' + e.message);
    }
    if (!data.methodsTree) throw new Error('project.json 缺少 methodsTree，不是有效的 AstroKnot 项目');
    return data;
  }

  // ── 落盘（FSCore，AstroKnot-Data 根内相对路径） ──
  function bytesToBase64(bytes) {
    var CHUNK = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(''));
  }
  /** 把收集到的文件树写入 projects/<dir>/（覆盖语义：先删旧目录） */
  async function writeProjectFiles(dir, files, onProgress) {
    var fsc = window.FSCore;
    var target = 'projects/' + dir;
    try { await fsc.rmrf(target); } catch (e) { /* 首次不存在 */ }
    await fsc.ensureDir(target);
    var names = Object.keys(files);
    for (var i = 0; i < names.length; i++) {
      var rel = names[i];
      var data = files[rel];
      var path = target + '/' + rel;
      if (BINARY_EXT.has(extOf(rel))) {
        await fsc.writeBase64(path, bytesToBase64(data));
      } else {
        await fsc.writeText(path, new TextDecoder().decode(data));
      }
      if (onProgress && (i + 1) % 20 === 0) onProgress('写入 ' + (i + 1) + '/' + names.length);
    }
    return names.length;
  }

  // ── 注册进项目体系（清单 + 当前会话） ──
  function registerImported(p, dir) {
    var folderPath = 'projects/' + dir;
    var id = null;
    if (window.ProjectFsShim && window.ProjectFsShim.registerExternalProject) {
      id = window.ProjectFsShim.registerExternalProject(p.name, folderPath);
    }
    // 当前会话立即可见（打开项目走 folderPath 懒加载链路）
    var projects = window.appState && window.appState.projects;
    if (projects) {
      var live = projects.find(function (x) { return x.folderPath === folderPath; });
      if (live) {
        live.name = p.name;
        id = live.id || id;
      } else {
        projects.push({ id: id, name: p.name, data: null, folderPath: folderPath });
      }
    }
    return id;
  }

  // ── 同步核心（无 UI 状态，失败抛错） ──
  async function importProjectCore(p) {
    setStatus('正在下载「' + p.name + '」…');
    var bytes = await httpGetBytes(currentConn, '/api/project?dir=' + encodeURIComponent(p.dir));
    setStatus('已下载 ' + Math.round(bytes.length / 1024) + ' KB，解压中…');
    var tar = await gunzip(bytes);
    var entries = parseTar(tar);
    if (!entries.length) throw new Error('tar 内容为空，文件可能损坏');
    var root = findProjectRoot(entries);
    var collected = collectProjectFiles(entries, root);
    parseProjectJson(collected.files); // 校验（实际落盘用 tar 内文件树，保持桌面同构）
    var n = await writeProjectFiles(p.dir, collected.files, setStatus);
    setStatus('✓ 已同步「' + p.name + '」：' + n + ' 个文件' + (collected.skippedVersionGraph ? '（跳过版本图 ' + collected.skippedVersionGraph + '）' : ''));
    registerImported(p, p.dir);
    window.dispatchEvent(new CustomEvent('ak-projects-changed'));
  }

  async function importOne(p, btn) {
    var oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      await importProjectCore(p);
      btn.textContent = '✓ 已同步';
      setTimeout(function () { btn.textContent = '导入'; btn.disabled = false; }, 1200);
    } catch (e) {
      setStatus(e.message || String(e), true);
      btn.textContent = '✗ 失败';
      setTimeout(function () { btn.textContent = oldText; btn.disabled = false; }, 1500);
    }
  }

  async function syncAll() {
    if (!currentConn || syncingAll) return;
    if (!lastProjects.length) { await fetchList(); }
    if (!lastProjects.length) { setStatus('桌面端没有可同步的项目'); return; }
    syncingAll = true;
    var done = 0, failed = 0;
    for (var i = 0; i < lastProjects.length; i++) {
      var p = lastProjects[i];
      var btn = rowBtns.get(p.dir);
      setStatus('全部同步中（' + (i + 1) + '/' + lastProjects.length + '）：' + p.name + '…');
      try {
        await importProjectCore(p);
        done++;
        if (btn) btn.textContent = '✓ 已同步';
      } catch (e) {
        failed++;
        if (btn) btn.textContent = '✗ 失败';
      }
    }
    syncingAll = false;
    setStatus('全部同步完成：成功 ' + done + ' 个' + (failed ? '，失败 ' + failed + ' 个（可单独重试）' : ''), failed > 0);
    setTimeout(closeDialog, 1500);
  }

  // ── 项目列表 ──
  function readInputs() {
    var host = el('ds-host').value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    var token = el('ds-token').value.trim();
    if (!host || !token) { setStatus('请输入 桌面地址 和 配对码（桌面端「移动端同步」弹窗中查看）', true); return null; }
    currentConn = { host: host, token: token };
    return currentConn;
  }

  async function fetchList() {
    var conn = readInputs();
    if (!conn) return;
    var listEl = el('ds-list');
    var hadList = lastProjects.length > 0;
    if (!hadList) listEl.innerHTML = '<div class="ds-empty">获取中…</div>';
    setStatus(hadList ? '刷新中…' : '');
    try {
      var info = await httpGetJson(conn, '/api/info');
      lastProjects = info.projects || [];
      saveConn(conn); // 连接成功即持久配对
      renderList(listEl, lastProjects);
      setStatus('桌面端共 ' + lastProjects.length + ' 个项目，可单个导入或点「同步全部」');
    } catch (e) {
      if (!hadList) listEl.innerHTML = '<div class="ds-empty">连接失败</div>';
      setStatus(e.message || String(e), true);
    }
  }

  function renderList(listEl, projects) {
    listEl.innerHTML = '';
    rowBtns.clear();
    if (!projects.length) {
      listEl.innerHTML = '<div class="ds-empty">桌面端没有可同步的项目</div>';
      return;
    }
    projects.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'ds-item';
      var sizeStr = p.bytes > 1048576 ? (p.bytes / 1048576).toFixed(1) + ' MB' : Math.round(p.bytes / 1024) + ' KB';
      row.innerHTML =
        '<div class="ds-item-info"><div class="ds-item-name"></div>' +
        '<div class="ds-item-meta">' + p.fileCount + ' 文件 · ' + sizeStr + '</div></div>' +
        '<button class="btn-mini ds-item-btn">导入</button>';
      row.querySelector('.ds-item-name').textContent = p.name;
      var btn = row.querySelector('.ds-item-btn');
      rowBtns.set(p.dir, btn);
      btn.addEventListener('click', function () { importOne(p, btn); });
      listEl.appendChild(row);
    });
  }

  // ── 弹窗 ──
  function el(id) { return _overlay.querySelector('#' + id); }
  function setStatus(msg, isError) {
    var s = el('ds-status');
    s.textContent = msg;
    s.style.color = isError ? '#ff8080' : '#5a8a5a';
  }

  function openDialog(ghOverlay) {
    if (!_overlay) {
      _overlay = createOverlay();
      document.body.appendChild(_overlay);
      bindEvents();
    }
    _overlay.style.display = 'flex';
    _overlay._ghOverlay = ghOverlay || null;
    // 预填持久 conn，自动拉列表（持续配对）
    var conn = loadConn();
    if (conn) {
      el('ds-host').value = conn.host;
      el('ds-token').value = conn.token;
      currentConn = conn;
      setStatus('已配对桌面端 ' + conn.host + '，正在获取项目列表…');
      fetchList();
    }
  }

  function closeDialog() {
    if (_overlay) _overlay.style.display = 'none';
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'deskSyncOverlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:var(--modal-overlay);backdrop-filter:blur(12px);z-index:100100;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <style>
        #deskSyncOverlay .ds-field{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
        #deskSyncOverlay .ds-field label{color:var(--text-secondary);font-size:12px;width:64px;flex-shrink:0;text-align:right;}
        #deskSyncOverlay .ds-field input{flex:1;padding:8px 10px;background:var(--input-bg);border:1px solid var(--input-border);border-radius:8px;color:var(--text-primary);font-size:13px;outline:none;}
        #deskSyncOverlay .ds-btn{padding:8px 16px;border:none;border-radius:8px;background:var(--accent,#2a6e8a);color:#fff;font-size:12px;cursor:pointer;}
        #deskSyncOverlay .ds-btn.ghost{background:transparent;border:1px solid var(--panel-border);color:var(--text-secondary);}
        #deskSyncOverlay #ds-list{margin-top:12px;max-height:300px;overflow-y:auto;border:1px solid var(--divider);border-radius:8px;min-height:60px;}
        #deskSyncOverlay .ds-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--divider);}
        #deskSyncOverlay .ds-item:last-child{border-bottom:none;}
        #deskSyncOverlay .ds-item-info{flex:1;min-width:0;}
        #deskSyncOverlay .ds-item-name{color:var(--text-primary);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        #deskSyncOverlay .ds-item-meta{color:var(--text-secondary);font-size:11px;margin-top:2px;}
        #deskSyncOverlay .btn-mini{padding:5px 12px;border:1px solid var(--panel-border);border-radius:6px;background:transparent;color:var(--text-primary);font-size:11px;cursor:pointer;}
        #deskSyncOverlay .ds-empty{padding:20px;text-align:center;color:var(--text-secondary);font-size:12px;}
      </style>
      <div class="rich-modal-content" style="width:460px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:var(--panel-radius);box-shadow:var(--panel-shadow);overflow:hidden;">
        <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--divider);">
          <span style="color:var(--text-primary);font-size:15px;font-weight:600;flex:1;display:flex;align-items:center;gap:7px;">
            <span style="font-size:16px;">📥</span> 从电脑同步
          </span>
          <button id="ds-close" title="关闭" style="background:none;border:none;color:var(--text-secondary);font-size:16px;cursor:pointer;padding:4px 8px;">✕</button>
        </div>
        <div style="padding:16px 20px;overflow-y:auto;">
          <div style="color:var(--text-secondary);font-size:12px;line-height:1.7;margin-bottom:12px;">
            与电脑在<b style="color:var(--text-primary);">同一 Wi-Fi / 局域网</b>，输入电脑「移动端同步」弹窗中显示的<b style="color:var(--text-primary);">地址</b>与<b style="color:var(--text-primary);">配对码</b>。配对一次后自动记住。
          </div>
          <div class="ds-field"><label>电脑地址</label><input id="ds-host" type="text" placeholder="如 192.168.1.100:8899"></div>
          <div class="ds-field"><label>配对码</label><input id="ds-token" type="text" placeholder="桌面端设置的配对码" maxlength="16"></div>
          <div style="display:flex;gap:10px;margin-top:12px;">
            <button id="ds-fetch" class="ds-btn">连接并刷新列表</button>
            <button id="ds-sync-all" class="ds-btn ghost">同步全部</button>
          </div>
          <div id="ds-list"></div>
          <div id="ds-status" style="margin-top:10px;color:#5a8a5a;font-size:12px;min-height:16px;line-height:1.6;"></div>
        </div>
      </div>
    `;
    return overlay;
  }

  function bindEvents() {
    el('ds-close').addEventListener('click', closeDialog);
    el('ds-fetch').addEventListener('click', fetchList);
    el('ds-sync-all').addEventListener('click', syncAll);
    el('ds-token').addEventListener('keydown', function (e) { if (e.key === 'Enter') fetchList(); });
    _overlay.addEventListener('click', function (e) { if (e.target === _overlay) closeDialog(); });
  }

  window.__DeskSync = { openDialog: openDialog, closeDialog: closeDialog };
  console.log('[tablet] 桌面同步垫片已加载（配对码模式）');
})();
