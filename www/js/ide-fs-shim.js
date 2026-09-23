// ============================================================
// AstroKnot Tablet - IDE 文件接口垫片（平板专属）
//
// 根因: 桌面 IDE 的文件读写全部走 Electron 主进程 IPC（preload.js 的
//   ide* / terminal* 接口，实现在 main/ipc-file/ide-fs.js），平板
//   WebView 没有主进程，web-api-shim.js 又未实现这些接口，导致 IDE
//   只能打开空壳（editor-lifecycle.js 缺接口守卫直接 return）。
//
// 方案: 用 Capacitor Filesystem 插件（Directory.Data 应用私有存储）
//   在垫片层实现与桌面 ide-fs.js 完全一致的返回格式，桌面源码零改动：
//   - 虚拟路径约定：全部为相对虚拟根的 '/' 分隔路径（如
//     sandbox-tmp/{nodeId}/sandbox、workspace），内部映射到 Data 根
//   - ideGetNodeSandboxPath：打开时把 node.fileSystem（内嵌 VFS）落盘
//   - ideWriteFile/CreateItem/DeleteItem/RenameItem：编辑直写磁盘
//   - ideSyncSandboxToNode：IDE 关闭时磁盘读回 node.fileSystem
//     （AppRunner._syncIdeToNode → saveCurrentProjectData 存 localStorage）
//   - ideStartSandboxServer 返回失败 → 预览自动回退 srcdoc 模式（preview.js）
//   - terminalSpawn 返回失败 → 终端面板显示"创建失败"（terminal.js 有守卫）
//
// 注意: 文本编码必须用小写 'utf8'（Capacitor native 大写 UTF8 会报错）
// ============================================================
(function () {
  'use strict';

  const UTF8 = 'utf8';
  const DATA = 'DATA'; // Capacitor Directory.Data（fs-core 不可用时的兜底目录）

  const FS = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) || null;

  // ── 统一根路由：fs-core 已加载 → Documents/Data 自适应根 + 'AstroKnot-Data' 前缀；
  //    缺失（异常场景）→ 沿用 Data 直连 ──
  const fsc = window.FSCore || null;
  function dirConst() { return fsc ? fsc.dir() : DATA; }
  function rp(p) { return fsc ? fsc.abs(p) : p; } // 虚拟路径 → 根内路径

  // IDE 会话节点登记（project-fs-shim 写盘时跳过 sandbox 重写，防旧 VFS 覆盖 IDE 磁盘编辑）
  if (fsc) {
    if (!fsc.ideActiveNodes) fsc.ideActiveNodes = new Set();
    if (!fsc.ideSandboxNodeMap) fsc.ideSandboxNodeMap = new Map();
  }

  // 与桌面 main/ipc-file/helpers.js 保持一致
  const BINARY_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tiff', 'tif', 'svg',
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma',
    'mp4', 'webm', 'avi', 'mov', 'mkv', 'wmv', 'flv',
    'zip', 'gz', 'tar', 'rar', '7z', 'bz2',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'pdf', 'exe', 'dll', 'so', 'dylib', 'bin', 'dat',
    'psd', 'ai', 'sketch', 'xd',
  ]);
  const IMAGE_MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    svg: 'image/svg+xml', ico: 'image/x-icon',
  };
  const LANG_MAP = {
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    json: 'json', md: 'markdown', py: 'python', xml: 'xml', svg: 'xml',
    yaml: 'yaml', yml: 'yaml', txt: 'plaintext', sql: 'sql',
  };

  // ---------- 虚拟路径规范化：统一 / 分隔，解析 ./ ../（防逃逸） ----------
  function norm(p) {
    if (!p) return '';
    const out = [];
    for (let seg of String(p).replace(/\\/g, '/').split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return out.join('/');
  }
  function join(base, name) { return norm(base ? base + '/' + name : name); }
  function basename(p) { const n = norm(p); return n ? n.split('/').pop() : ''; }

  // ---------- 基础原语（虚拟路径经 fs-core 路由到统一根） ----------
  async function fsStat(path) {
    try {
      const r = await FS().stat({ path: rp(path), directory: dirConst() });
      return { isDir: r.type === 'directory', size: r.size || 0, mtime: r.mtime || 0 };
    } catch (e) { return null; }
  }
  async function ensureDir(path) {
    if (!path) return;
    try {
      await FS().mkdir({ path: rp(path), directory: dirConst(), recursive: true });
    } catch (e) {
      // Capacitor mkdir 对已存在目录即使 recursive:true 也会 reject → 验证存在即忽略
      const st = await fsStat(path);
      if (!st || !st.isDir) throw e;
    }
  }
  async function readText(path) {
    const r = await FS().readFile({ path: rp(path), directory: dirConst(), encoding: UTF8 });
    return r.data;
  }
  async function readBase64(path) {
    const r = await FS().readFile({ path: rp(path), directory: dirConst() }); // 无 encoding → base64
    return r.data;
  }
  async function writeText(path, content) {
    await FS().writeFile({ path: rp(path), directory: dirConst(), data: String(content ?? ''), encoding: UTF8, recursive: true });
  }
  async function writeBase64(path, b64) {
    await FS().writeFile({ path: rp(path), directory: dirConst(), data: String(b64 ?? ''), recursive: true });
  }
  async function removePath(path) {
    try { await FS().unlink({ path: rp(path), directory: dirConst() }); } catch (e) { /* 不存在视为已删 */ }
  }

  // ---------- 桌面同款辅助 ----------
  function sanitizeNodeFolderName(name) {
    return String(name || '未命名').replace(/[<>:"\\/|?*]/g, '_').slice(0, 50) || '未命名';
  }
  function getNodeFolderName(node) {
    return `${sanitizeNodeFolderName(node && node.name)}_${String(node && node.id || '').slice(0, 8)}`;
  }

  // ---------- VFS ↔ 磁盘（移植 helpers.js 读写函数） ----------
  async function writeFileSystemToDisk(node, dirPath) {
    if (!node || !node.children) return;
    for (const child of node.children) {
      if (child.type === 'file') {
        const p = join(dirPath, child.name);
        if (child.isBinary && child.content) await writeBase64(p, child.content);
        else await writeText(p, child.content || '');
      } else if (child.type === 'directory') {
        const sub = join(dirPath, child.name);
        await ensureDir(sub);
        await writeFileSystemToDisk(child, sub);
      }
    }
  }

  async function readFileSystemFromDisk(dirPath, skipNodeModules) {
    const st = await fsStat(dirPath);
    if (!st || !st.isDir) return null;
    const { files } = await FS().readdir({ path: dirPath, directory: DATA });
    const children = [];
    for (const entry of files) {
      if (skipNodeModules && entry.type === 'directory' && entry.name === 'node_modules') continue;
      const p = join(dirPath, entry.name);
      if (entry.type === 'directory') {
        const sub = await readFileSystemFromDisk(p, skipNodeModules);
        if (sub) children.push(sub);
      } else {
        const ext = entry.name.split('.').pop().toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
          children.push({ type: 'file', name: entry.name, content: await readBase64(p), language: LANG_MAP[ext] || 'plaintext', isBinary: true });
        } else {
          children.push({ type: 'file', name: entry.name, content: await readText(p), language: LANG_MAP[ext] || 'plaintext', isBinary: false });
        }
      }
    }
    children.sort((a, b) => (a.type !== b.type) ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
    return { type: 'directory', name: basename(dirPath), children };
  }

  // ---------- window.api 接口（返回格式与桌面 ide-fs.js 一致） ----------
  if (!window.api) window.api = {};
  Object.assign(window.api, {

    // 平板无系统目录选择对话框 → 打开固定虚拟工作区
    ideSelectFolder: async () => {
      if (!FS()) return null;
      await ensureDir('workspace');
      return 'workspace';
    },

    // 平板无目录选择器，导入本地文件夹暂不支持
    ideImportLocalFolder: async () => null,

    // 打开节点 IDE / 预览：返回 sandbox 虚拟路径；skipRewrite 为假时把 node.fileSystem 落盘
    ideGetNodeSandboxPath: async (node, projectFolderPath, options) => {
      try {
        if (!FS()) return { success: false, error: 'Capacitor Filesystem 不可用' };
        let sandboxDir;
        if (projectFolderPath) {
          sandboxDir = norm(projectFolderPath) + '/nodes/' + getNodeFolderName(node) + '/sandbox';
        } else {
          sandboxDir = 'sandbox-tmp/' + (node && node.id) + '/sandbox';
        }
        if (node && node.fileSystem && !(options && options.skipRewrite)) {
          await removePath(sandboxDir);
          await ensureDir(sandboxDir);
          await writeFileSystemToDisk(node.fileSystem, sandboxDir);
        } else {
          await ensureDir(sandboxDir);
        }
        // 登记 IDE 会话节点（project-fs-shim 防抖保存时跳过该节点 sandbox 重写）
        if (fsc && node && node.id) {
          fsc.ideActiveNodes.add(node.id);
          fsc.ideSandboxNodeMap.set(sandboxDir, node.id);
        }
        return { success: true, sandboxPath: sandboxDir };
      } catch (err) {
        console.error('[ide-fs-shim] ideGetNodeSandboxPath 错误:', err);
        return { success: false, error: err.message };
      }
    },

    // IDE 关闭时同步：磁盘 → node.fileSystem（含二进制 base64，跳过 node_modules）
    ideSyncSandboxToNode: async (sandboxDir) => {
      try {
        if (!FS()) return { success: false, error: 'Capacitor Filesystem 不可用' };
        const dir = norm(sandboxDir);
        // 解除会话登记：磁盘 VFS 已读回内存，防抖保存可安全重写 sandbox
        const activeNodeId = fsc ? fsc.ideSandboxNodeMap.get(dir) : null;
        if (fsc) {
          if (activeNodeId) fsc.ideActiveNodes.delete(activeNodeId);
          fsc.ideSandboxNodeMap.delete(dir);
        }
        const st = await fsStat(dir);
        if (!st || !st.isDir) return { success: true, fileSystem: null };
        const fileSystem = await readFileSystemFromDisk(dir, true);
        return { success: true, fileSystem };
      } catch (err) {
        console.error('[ide-fs-shim] ideSyncSandboxToNode 错误:', err);
        return { success: false, error: err.message };
      }
    },

    // 递归目录树（桌面只收目录，文件不进树；跳过隐藏目录与 node_modules）
    ideReadDirTree: async (dirPath) => {
      const root = norm(dirPath);
      async function scan(dir) {
        const node = { children: {} };
        try {
          const { files } = await FS().readdir({ path: rp(dir), directory: dirConst() });
          for (const entry of files) {
            if (entry.type === 'directory' && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              node.children[entry.name] = await scan(join(dir, entry.name));
            }
          }
        } catch (e) { /* 读取失败按空目录 */ }
        return node;
      }
      const st = await fsStat(root);
      if (!st || !st.isDir) return {};
      return scan(root);
    },

    // 平铺目录列表
    ideReadDir: async (dirPath) => {
      const dir = norm(dirPath);
      const st = await fsStat(dir);
      if (!st || !st.isDir) return [];
      const items = [];
      try {
        const { files } = await FS().readdir({ path: rp(dir), directory: dirConst() });
        for (const entry of files) {
          items.push({
            name: entry.name,
            type: entry.type === 'directory' ? 'directory' : 'file',
            size: entry.type === 'file' ? (entry.size || 0) : 0,
            mtime: entry.mtime || 0,
          });
        }
      } catch (e) { /* 忽略 */ }
      return items;
    },

    // 读文件：{type:'text'|'image'|'binary'|'directory'|'error'}
    ideReadFile: async (filePath) => {
      const path = norm(filePath);
      if (!path) return { type: 'error', message: '路径为空' };
      const st = await fsStat(path);
      if (!st) return { type: 'error', message: '文件不存在' };
      if (st.isDir) return { type: 'directory' };
      if (st.size > 10 * 1024 * 1024) return { type: 'binary', size: st.size, message: '文件过大 (>10MB)' };
      const ext = (path.split('.').pop() || '').toLowerCase();
      try {
        if (IMAGE_MIME[ext]) {
          const b64 = await readBase64(path);
          return { type: 'image', dataUrl: `data:${IMAGE_MIME[ext]};base64,${b64}`, size: st.size };
        }
        const content = await readText(path);
        return { type: 'text', content, size: st.size };
      } catch (e) {
        return { type: 'error', message: e.message };
      }
    },

    ideWriteFile: async (filePath, content) => {
      const path = norm(filePath);
      if (!path) throw new Error('无效路径');
      try {
        await writeText(path, content);
        return { success: true };
      } catch (e) {
        throw new Error('写入失败: ' + e.message);
      }
    },

    ideCreateItem: async (dirPath, name, itemType) => {
      const dir = norm(dirPath);
      if (!dir || !name) throw new Error('无效参数');
      const abs = join(dir, name);
      if (await fsStat(abs)) throw new Error('项目已存在: ' + name);
      if (itemType === 'directory') {
        await ensureDir(abs);
      } else {
        await ensureDir(dir);
        await writeText(abs, '');
      }
      return { success: true };
    },

    ideDeleteItem: async (filePath) => {
      const path = norm(filePath);
      if (!path) throw new Error('参数无效');
      await removePath(path); // 幂等删除（与桌面一致）
      return { success: true };
    },

    ideRenameItem: async (filePath, newName) => {
      const from = norm(filePath);
      if (!from || !newName) throw new Error('参数无效');
      if (!(await fsStat(from))) throw new Error('参数无效');
      const idx = from.lastIndexOf('/');
      const to = join(idx > 0 ? from.slice(0, idx) : '', newName);
      if (await fsStat(to)) throw new Error('目标名称已存在: ' + newName);
      await FS().rename({ from: rp(from), to: rp(to), directory: dirConst(), toDirectory: dirConst() });
      return { success: true };
    },

    // 预览：平板无法起本地 HTTP server → 返回失败，preview.js 自动回退 srcdoc
    ideStartSandboxServer: async () => ({ success: false, error: '平板使用内嵌预览' }),
    ideStopSandboxServer: async () => {},

    // 终端：WebView 无 Node/PTY，terminal.js 有 success 守卫，优雅显示失败
    terminalSpawn: async () => ({ success: false, error: '平板版暂不支持终端' }),
    terminalInput: () => {},
    terminalResize: () => {},
    terminalKill: () => {},
    // 终端事件订阅：空实现（IDE 初始化时 SandboxTerminal 会注册，缺失会 TypeError 中断组件链）
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
    terminalGetSandboxCwd: async () => ({ success: false }),
    terminalListNpmScripts: async () => [],

    // ── 应用清单（AppLibrary）：桌面走 apps/index.json，平板用 localStorage 持久
    //    缺失后果：AppManager.loadApps → _saveAppList 抛 TypeError → AppPanel.refresh
    //    中断 → 应用库面板空白 → 内置 IDE/浏览器图标点不开
    readAppList: () => {
      try { return JSON.parse(localStorage.getItem('astroknot_apps_index')) || { apps: [] }; }
      catch { return { apps: [] }; }
    },
    writeAppList: (appList) => {
      try {
        localStorage.setItem('astroknot_apps_index', JSON.stringify(appList || { apps: [] }));
        return { success: true };
      } catch (e) { return { success: false, error: e.message }; }
    },
  });

  console.log('[tablet] IDE 文件接口垫片已加载（Capacitor Filesystem: '
    + (FS() ? '可用' : '不可用，浏览器环境 IDE 文件功能将不可用') + '）');
})();
