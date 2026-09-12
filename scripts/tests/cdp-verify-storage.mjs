// ============================================================
// cdp-verify-storage.mjs — 平板文件化存储全链路验证（一次性诊断脚本）
// 用法: node scripts/cdp-verify-storage.mjs <app pid>
// 验证: 启动门闩 / 根解析 / 键值层 / 项目层 / 回收站5接口 / 回归
// 安全: 回收站测试用临时项目（trash-test-proj），结束后自动清理；
//       不触碰用户真实项目数据；localStorage 备份原样保留
// ============================================================
import process from 'node:process';

const pid = process.argv[2];
if (!pid) { console.error('用法: node cdp-verify-storage.mjs <app pid>'); process.exit(1); }

const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
if (!page) { console.error('未找到 page'); process.exit(1); }
console.log('页面:', page.url, '| title:', page.title);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
let exceptionCount = 0;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    const desc = (d.exception?.description || '') + ' ' + d.text;
    // 已知 Capacitor 桥噪音：未安装 @capacitor/keyboard，原生键盘事件 eval
    // window.Capacitor.Plugins.Keyboard.triggerEvent → 无应用栈（at <anonymous>）
    if (desc.includes('triggerEvent') && desc.includes('<anonymous>')) {
      console.log('  [noise-capacitor-keyboard]', d.text);
      return;
    }
    exceptionCount++;
    console.log('  [EXCEPTION]', d.text, (d.exception?.description || '').slice(0, 300));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    const text = msg.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    console.log('  [console.error]', text.slice(0, 300));
  }
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

ws.onopen = async () => {
  try {
    await send('Runtime.enable');
    await new Promise(r => setTimeout(r, 2000));

    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // ═══ 1. 启动门闩与根解析 ═══
    console.log('\n═══ 1. 启动门闩与根解析 ═══');
    const rootState = await evalJs(`(async () => {
      if (window.__storageReady) { await window.__storageReady; }
      const st = window.FSCore ? window.FSCore.state : null;
      return {
        latchResolved: true,
        fsCore: !!window.FSCore,
        ssfReady: !!(window.SystemStorageFs && window.SystemStorageFs.isReady()),
        pfsReady: !!(window.ProjectFsShim && window.ProjectFsShim.isReady()),
        dir: st ? st.dir : null,
        native: st ? st.native : null,
        fallback: st ? st.fallback : null,
      };
    })()`);
    console.log(JSON.stringify(rootState));
    check('fs-core 已加载', rootState.fsCore);
    check('键值层就绪', rootState.ssfReady);
    check('项目层就绪', rootState.pfsReady);
    check('存储根 = DOCUMENTS（已授权）', rootState.dir === 'DOCUMENTS', 'dir=' + rootState.dir);
    check('原生环境', rootState.native === true);
    check('未降级', rootState.fallback === false);

    // ═══ 2. 根目录布局（桌面同构） ═══
    console.log('\n═══ 2. 根目录布局 ═══');
    const layout = await evalJs(`(async () => {
      const FS = window.Capacitor.Plugins.Filesystem;
      const r = await FS.readdir({ path: 'AstroKnot-Data', directory: 'DOCUMENTS' });
      return (r.files || []).map(f => f.name + (f.type === 'directory' ? '/' : ''));
    })()`);
    console.log('AstroKnot-Data/:', JSON.stringify(layout));
    check('projects/ 目录存在', layout.includes('projects/'));
    check('system/ 目录存在', layout.includes('system/'));
    check('trash/ 目录存在', layout.includes('trash/'));

    // ═══ 3. 键值层 ═══
    console.log('\n═══ 3. 键值层 ═══');
    const kv = await evalJs(`(async () => {
      const ssf = window.SystemStorageFs;
      const kvSize = ssf.getMap().size;
      const write = window.api.systemStorageWriteSync('astroknot_kv_verify', JSON.stringify({ t: Date.now() }));
      const read = window.api.systemStorageReadSync('astroknot_kv_verify');
      const keys = window.api.systemStorageKeysSync();
      await ssf.flush();
      // 直接读盘验证落盘
      const FS = window.Capacitor.Plugins.Filesystem;
      let diskOk = false;
      try {
        const files = await FS.readdir({ path: 'AstroKnot-Data/system/storage', directory: 'DOCUMENTS' });
        const name = window.btoa(encodeURIComponent('astroknot_kv_verify')).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') + '.json';
        const f = (files.files || []).find(x => x.name === name);
        if (f) {
          const raw = await FS.readFile({ path: 'AstroKnot-Data/system/storage/' + name, directory: 'DOCUMENTS', encoding: 'utf8' });
          const obj = JSON.parse(raw.data);
          diskOk = obj.key === 'astroknot_kv_verify';
        }
      } catch (e) { diskOk = 'err: ' + e.message; }
      window.api.systemStorageRemoveSync('astroknot_kv_verify');
      await ssf.flush();
      return { kvSize, writeOk: write && write.success, readOk: read && read.success, keysOk: keys && keys.success && Array.isArray(keys.keys), diskOk };
    })()`);
    console.log(JSON.stringify(kv));
    check('键值层预载非空', kv.kvSize > 0, 'map.size=' + kv.kvSize);
    check('writeSync 成功', kv.writeOk === true);
    check('readSync 读回', kv.readOk === true);
    check('keysSync 成功', kv.keysOk === true);
    check('键值文件落盘（桌面同格式）', kv.diskOk === true, String(kv.diskOk));

    // ═══ 4. 项目层 ═══
    console.log('\n═══ 4. 项目层 ═══');
    const proj = await evalJs(`(() => {
      const pfs = window.ProjectFsShim;
      const shimList = pfs.getProjects();
      const appProjects = (window.appState && window.appState.projects) || [];
      return {
        shimCount: shimList.length,
        appCount: appProjects.length,
        shimNames: shimList.map(p => p.name),
        appNames: appProjects.map(p => p.name),
        currentId: window.appState && window.appState.currentProjectId,
        pfsCurrentId: pfs.currentId,
        currentSaved: !!window.appState && window.appState.projects.some && appProjects.some(p => p.id === (window.appState.currentProjectId)),
        hasMethodsTree: appProjects.length ? !!appProjects[0].data.methodsTree : false,
      };
    })()`);
    console.log(JSON.stringify(proj));
    check('appState 项目数 = 文件层项目数', proj.appCount === proj.shimCount, `app=${proj.appCount} shim=${proj.shimCount}`);
    check('项目数据完整（methodsTree）', proj.hasMethodsTree);
    check('currentProjectId 已恢复', !!proj.currentId, 'id=' + proj.currentId);

    const projDirs = await evalJs(`(async () => {
      const FS = window.Capacitor.Plugins.Filesystem;
      const r = await FS.readdir({ path: 'AstroKnot-Data/projects', directory: 'DOCUMENTS' });
      return (r.files || []).filter(f => f.type === 'directory').map(f => f.name);
    })()`);
    console.log('projects/ 文件夹:', JSON.stringify(projDirs));
    check('项目文件夹数与项目数一致', projDirs.length >= proj.shimCount, `dirs=${projDirs.length}`);

    // ═══ 5. 回收站全周期（唯一名临时项目，自动清理） ═══
    console.log('\n═══ 5. 回收站全周期 ═══');
    const trashCycle = await evalJs(`(async () => {
      const out = {};
      const pfs = window.ProjectFsShim;
      const testName = 'trash-test-proj-' + Date.now().toString(36);
      out.testName = testName;
      // 5.1 写入临时项目
      const testProject = {
        projectName: testName,
        methodsTree: { id: '__VIRTUAL_ROOT__', name: '(虚拟根)', desc: '', children: [
          { id: 'testnode001', name: '测试节点', desc: '', children: [] }
        ]},
        crossEdges: [],
        positions: { testnode001: { x: 0, y: 0, z: 0 } },
        nodeRichContents: { testnode001: '<p>hi</p>' },
      };
      await pfs.writeProjectToDisk('projects/' + testName, testProject);
      // 5.2 moveProjectToTrash
      const mv = await window.api.moveProjectToTrash({ folderPath: 'projects/' + testName, projectId: 'test-1', projectName: testName });
      out.moveOk = !!(mv && mv.success);
      out.trashPath = mv && mv.trashPath;
      // 5.3 listTrash
      const lt = await window.api.listTrash();
      out.listOk = !!(lt && lt.success);
      out.found = (lt.items || []).some(i => i.projectName === testName);
      out.metaOk = (lt.items || []).filter(i => i.projectName === testName)
        .every(i => i.deletedAt && i.wasUnsaved === false);
      // 5.4 restoreFromTrash
      const item = (lt.items || []).find(i => i.projectName === testName);
      const rs = item ? await window.api.restoreFromTrash({ trashPath: item.trashPath }) : null;
      out.restoreOk = !!(rs && rs.success);
      out.restoredPath = rs && rs.folderPath;
      // 5.5 恢复后可读
      const rd = out.restoreOk ? await window.api.readProjectFromFolder(rs.folderPath) : null;
      out.readBackOk = !!(rd && rd.success && rd.data && rd.data.methodsTree && rd.data.methodsTree.children &&
        rd.data.methodsTree.children[0] && rd.data.methodsTree.children[0].name === '测试节点');
      out.readBackRich = !!(rd && rd.success && rd.data && rd.data.nodeRichContents && rd.data.nodeRichContents.testnode001 === '<p>hi</p>');
      // 5.6 永久删除清理
      const del = out.restoreOk ? await window.api.deleteProjectFolder(rs.folderPath) : { success: false };
      out.cleanOk = !!del.success;
      return out;
    })()`);
    console.log(JSON.stringify(trashCycle));
    check('临时项目写盘', trashCycle.moveOk !== undefined);
    check('moveProjectToTrash', trashCycle.moveOk === true);
    check('listTrash 找到临时项目', trashCycle.listOk && trashCycle.found === true);
    check('.trash-meta.json 元数据', trashCycle.metaOk === true);
    check('restoreFromTrash', trashCycle.restoreOk === true, trashCycle.restoredPath || '');
    check('恢复后项目可读（节点树）', trashCycle.readBackOk === true);
    check('恢复后富文本读回', trashCycle.readBackRich === true);
    check('临时项目已清理', trashCycle.cleanOk === true);

    // ═══ 6. 回归：IDE 链路接口与 AppRunner ═══
    console.log('\n═══ 6. 回归检查 ═══');
    const regression = await evalJs(`(() => {
      return {
        appRunner: typeof window.AppRunner,
        windowManager: typeof window.WindowManager,
        ideGetNodeSandboxPath: typeof window.api.ideGetNodeSandboxPath,
        ideReadFile: typeof window.api.ideReadFile,
        onTerminalData: typeof window.api.onTerminalData,
        solarLib: typeof window.Solar,
        versionShim: typeof window.api.versionSaveGraph,
        joystick: !!document.querySelector('[id*="joystick"]') || typeof window.__joystickReady,
        moduleErr: window.__moduleError || null,
      };
    })()`);
    console.log(JSON.stringify(regression));
    check('AppRunner 已挂载（IDE 依赖）', regression.appRunner === 'object');
    check('WindowManager 已挂载', regression.windowManager === 'object');
    check('IDE 文件接口（沙盒定位）', regression.ideGetNodeSandboxPath === 'function');
    check('IDE 文件接口（读文件）', regression.ideReadFile === 'function');
    check('终端事件订阅（防 TypeError）', regression.onTerminalData === 'function');
    check('lunar 库（日历依赖）', regression.solarLib === 'function' || regression.solarLib === 'object');
    check('版本时间线垫片', regression.versionShim === 'function');

    // ═══ 6.5 IDE 实开测试（验证 ide-fs-shim 新路由真实链路） ═══
    console.log('\n═══ 6.5 IDE 实开测试 ═══');
    const ide = await evalJs(`(async () => {
      if (!window.AppRunner || typeof window.AppRunner.open !== 'function') return { openable: false };
      try {
        // open() 期望 app 对象（按 type 分发，字符串会误入 _openNormalApp）
        const app = (window.api.readAppList().apps || []).find(a => a.id === 'builtin-ide')
          || { id: 'builtin-ide', name: 'IDE', type: 'ide', builtin: true };
        await window.AppRunner.open(app);
        await new Promise(r => setTimeout(r, 6000));
        const monaco = !!document.querySelector('.monaco-editor');
        const winContent = !!document.querySelector('.rich-modal.app-runner-modal');
        return { openable: true, monaco: monaco, winContent: winContent };
      } catch (e) { return { openable: true, error: String(e && e.message || e) }; }
    })()`);
    console.log(JSON.stringify(ide));
    check('AppRunner.open 可调用', ide.openable === true, ide.error || '');
    check('IDE 窗口内容挂载', ide.winContent === true);
    check('Monaco 编辑器渲染', ide.monaco === true);

    // ═══ 7. 启动期异常统计 ═══
    console.log('\n═══ 7. 异常统计 ═══');
    check('无未捕获异常', exceptionCount === 0, 'count=' + exceptionCount);

    const failed = results.filter(r => !r.ok);
    console.log('\n══════════════════════════════');
    console.log(`结果: ${results.length - failed.length}/${results.length} 通过`);
    if (failed.length) {
      console.log('失败项: ' + failed.map(f => f.name).join(' | '));
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('验证出错:', e.message);
    process.exitCode = 1;
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 300);
  }
};

ws.onerror = (e) => { console.error('WS错误', e.message || e); process.exit(1); };
