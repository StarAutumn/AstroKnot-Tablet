// 验证启动首页核心交互：最近项目点击 → 项目打开
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const desc = (d.exception?.description || '') + ' ' + d.text;
    if (desc.includes('triggerEvent') && desc.includes('<anonymous>')) return; // Capacitor 桥噪音
    console.log('[EXCEPTION]', d.text, (d.exception?.description || '').slice(0, 300));
  }
};
ws.onopen = async () => {
  await send('Runtime.enable');
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
  };
  await new Promise(r => setTimeout(r, 1000));

  // 1. 重新显示启动首页
  const show = await ev(`(async () => {
    const m = await import('./modules/StartPage/index.js');
    m.showStartPage();
    await new Promise(s => setTimeout(s, 300));
    const el = document.getElementById('startPage');
    const items = [...document.querySelectorAll('#recentProjectsList .recent-project-item')].map(i => i.querySelector('.recent-project-name')?.textContent);
    return { visible: !!el && el.style.display === 'flex', items };
  })()`);
  check('启动首页可重新显示 + 最近项目条目', show.visible && show.items.length > 0, JSON.stringify(show));

  // 2. 点击最近项目 → 项目打开（startPage 隐藏 + currentProjectId 设置 + 场景有节点）
  const open = await ev(`(async () => {
    const before = { currentId: window.appState.currentProjectId, nodes: window.appState.nodeMap ? window.appState.nodeMap.size : -1 };
    const item = document.querySelector('#recentProjectsList .recent-project-item');
    if (!item) return { ok: false, why: 'no-item', before };
    item.click();
    // 轮询 startPage 隐藏 + 项目加载，最多 8s（可能走 loadProjectFromFolder 异步磁盘加载）
    let t0 = Date.now(), pageHidden = false, projLoaded = false;
    while (Date.now() - t0 < 8000) {
      await new Promise(s => setTimeout(s, 300));
      pageHidden = document.getElementById('startPage').style.display === 'none';
      projLoaded = !!window.appState.currentProjectId && window.appState.methodsTree && window.appState.methodsTree.children && window.appState.methodsTree.children.length > 0;
      if (pageHidden && projLoaded) break;
    }
    return { ok: pageHidden && projLoaded, before,
      after: { currentId: window.appState.currentProjectId, name: (window.appState.projects.find(p => p.id === window.appState.currentProjectId) || {}).name,
        nodes: window.appState.nodeMap ? window.appState.nodeMap.size : -1,
        treeChildren: window.appState.methodsTree ? window.appState.methodsTree.children.length : -1 },
      pageHidden, projLoaded, elapsed: Date.now() - t0 };
  })()`);
  check('点击最近项目 → 项目打开（首页收起+树恢复）', open.ok, JSON.stringify(open));

  // 3. 新建项目按钮存在且可点（不实际点击，避免污染项目列表——验证绑定与隐藏按钮即可）
  const btns = await ev(`(() => {
    const m = document.getElementById('startPageNewProject');
    const openBtn = document.getElementById('startPageOpenProject');
    const closeBtn = document.getElementById('startPageClose');
    return { newBtn: !!m, openBtnHidden: openBtn && openBtn.style.display === 'none', closeBtn: !!closeBtn };
  })()`);
  check('新建/关闭按钮存在 + 打开项目按钮已隐藏', btns.newBtn && btns.openBtnHidden && btns.closeBtn, JSON.stringify(btns));

  const pass = results.filter(Boolean).length;
  console.log(`\n=== ${pass}/${results.length} 通过 ===`);
  process.exit(pass === results.length ? 0 : 1);
};
