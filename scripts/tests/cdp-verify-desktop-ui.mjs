// 一次性：验证桌面图标模式 + 应用库侧边栏 + 此 AstroKnot 左侧目录树
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
    if (desc.includes('triggerEvent') && desc.includes('<anonymous>')) return;
    console.log('[EXCEPTION]', d.text, (d.exception?.description || '').slice(0, 250));
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
  // 等待应用启动完成（module 门闩 + appState 创建 + 图标渲染），再等 2s 让启动期重渲染稳定
  for (let i = 0; i < 30; i++) {
    const s = await ev(`(() => ({ ready: !!(window.appState && window.appState.dockLayoutMode), icons: document.querySelectorAll('#desktopIconsLayer .desktop-icon').length }))()`);
    if (s.ready && s.icons > 0) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  await new Promise(r => setTimeout(r, 2000));

  // 0. 启动首页：启动时显示（logo/新建按钮/最近项目），验证后关闭进入桌面测试
  const sp = await ev(`(() => {
    const el = document.getElementById('startPage');
    const visible = !!el && el.style.display === 'flex';
    const recent = [...document.querySelectorAll('#recentProjectsList .recent-project-name')].map(n => n.textContent);
    const hidden = !!document.getElementById('startPageOpenProject') && document.getElementById('startPageOpenProject').style.display === 'none';
    return { visible, recent, hidden };
  })()`);
  check('启动首页显示（最近项目+隐藏打开项目按钮）', sp.visible && sp.hidden, JSON.stringify(sp));
  await ev(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);
  await new Promise(r => setTimeout(r, 400));

  // 1. 桌面图标模式生效
  const mode = await ev(`(() => ({ mode: window.appState.dockLayoutMode, layerShown: document.getElementById('desktopIconsLayer')?.style.display, icons: [...document.querySelectorAll('#desktopIconsLayer .desktop-icon')].map(i => i.querySelector('.desktop-icon-label')?.textContent) }))()`);
  check('桌面图标模式 + 图标渲染', mode.mode === 'desktop' && mode.layerShown === 'block' && mode.icons.length >= 2, JSON.stringify(mode));

  // 2. 触控垫片已挂载
  const bound = await ev(`(() => ({ layer: !!document.getElementById('desktopIconsLayer')?.__touchBound, items: !!document.getElementById('dockAppItems')?.__touchBound }))()`);
  check('desktop-ui-touch 已挂载', bound.layer && bound.items, JSON.stringify(bound));

  // 3. 模拟触摸桌面图标：tap（选中）→ 双击（打开应用）
  const tapOpen = await ev(`(async () => {
    let icon = document.querySelector('#desktopIconsLayer .desktop-icon');
    if (!icon) return { ok: false };
    const mk = (type, iconEl) => {
      const r = iconEl.getBoundingClientRect();
      const t = () => new Touch({ identifier: 1, target: iconEl, clientX: r.left + 40, clientY: r.top + 40 });
      return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t()], targetTouches: type === 'touchend' ? [] : [t()], changedTouches: [t()] });
    };
    icon.dispatchEvent(mk('touchstart', icon));
    await new Promise(s => setTimeout(s, 60));
    icon.dispatchEvent(mk('touchend', icon));
    await new Promise(s => setTimeout(s, 100));
    const selected = icon.classList.contains('selected');
    // 第二次 tap → 合成 click+dblclick → 打开应用（重新查询，防渲染竞态）
    icon = document.querySelector('#desktopIconsLayer .desktop-icon');
    icon.dispatchEvent(mk('touchstart', icon));
    await new Promise(s => setTimeout(s, 60));
    icon.dispatchEvent(mk('touchend', icon));
    // 轮询窗口出现（冷启动首次加载模块可能 >2.5s），最多 8s
    let winOpen = false, t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      await new Promise(s => setTimeout(s, 300));
      if (document.querySelector('.rich-modal.app-runner-modal')) { winOpen = true; break; }
    }
    const label = icon.isConnected ? icon.querySelector('.desktop-icon-label')?.textContent : undefined;
    return { ok: selected && winOpen, selected, winOpen, label, elapsed: Date.now() - t0 };
  })()`);
  check('图标 tap 选中 + 双击打开应用', tapOpen.ok, JSON.stringify(tapOpen));

  // 4. 关掉刚打开的窗口
  await ev(`(() => { document.querySelector('.rich-modal.app-runner-modal .app-runner-close')?.click(); return true; })()`);
  await new Promise(r => setTimeout(r, 600));

  // 5. 左缘点按呼出侧边栏（触摸 target 必须是真实背景元素，如 body）
  const edge = await ev(`(async () => {
    document.body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [new Touch({ identifier: 2, target: document.body, clientX: 10, clientY: 400 })] }));
    await new Promise(s => setTimeout(s, 400));
    const panel = document.getElementById('dockPanel');
    const shown = panel?.classList.contains('visible');
    return { shown, display: panel?.style.display };
  })()`);
  check('左缘点按呼出侧边栏', edge.shown === true, JSON.stringify(edge));

  // 6. 侧边栏 tap 选中 + 双击打开（回收站）
  const sideItem2 = await ev(`(async () => {
    const item = [...document.querySelectorAll('#dockAppItems .dock-app-item')].find(i => i.querySelector('.dock-app-label')?.textContent?.includes('回收站'));
    if (!item) return { ok: false, labels: [...document.querySelectorAll('#dockAppItems .dock-app-item')].map(i => i.querySelector('.dock-app-label')?.textContent) };
    const t = () => new Touch({ identifier: 3, target: item, clientX: 200, clientY: item.getBoundingClientRect().top + 20 });
    const mk = (type) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [t()], targetTouches: type === 'touchend' ? [] : [t()], changedTouches: [t()] });
    item.dispatchEvent(mk('touchstart'));
    await new Promise(s => setTimeout(s, 60));
    item.dispatchEvent(mk('touchend'));
    await new Promise(s => setTimeout(s, 80));
    const selected = item.classList.contains('selected');
    item.dispatchEvent(mk('touchstart'));
    await new Promise(s => setTimeout(s, 60));
    item.dispatchEvent(mk('touchend'));
    // 轮询窗口出现（冷启动首次加载模块可能 >2.5s），最多 8s
    let winOpen = false, t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      await new Promise(s => setTimeout(s, 300));
      if ([...document.querySelectorAll('.app-runner-title')].some(el => el.textContent.includes('回收站'))) { winOpen = true; break; }
    }
    const panelHidden = !document.getElementById('dockPanel')?.classList.contains('visible');
    return { ok: selected && winOpen && panelHidden, selected, winOpen, panelHidden, elapsed: Date.now() - t0 };
  })()`);
  check('侧边栏 tap 选中 + 双击打开回收站 + 面板自动收起', sideItem2.ok, JSON.stringify(sideItem2));

  // 7. 关窗口 + 点面板外收起侧边栏
  await ev(`(() => { document.querySelector('.rich-modal.app-runner-modal .app-runner-close')?.click(); return true; })()`);
  await new Promise(r => setTimeout(r, 500));
  const outside = await ev(`(async () => {
    document.body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [new Touch({ identifier: 4, target: document.body, clientX: 600, clientY: 400 })] }));
    await new Promise(s => setTimeout(s, 300));
    return { shown: document.getElementById('dockPanel')?.classList.contains('visible') };
  })()`);
  check('点面板外收起侧边栏', outside.shown === false, JSON.stringify(outside));

  // 8. 此 AstroKnot 左侧目录树
  const fm = await ev(`(async () => {
    const r = window.api.readAppList(); const list = (r && r.then) ? await r : r;
    const app = (list.apps || []).find(a => a.id === 'builtin-file-manager');
    await window.AppRunner.open(app);
    await new Promise(s => setTimeout(s, 2500));
    const tree = document.getElementById('fmDirTree');
    const sidebar = document.getElementById('fmSidebar');
    return {
      items: tree ? [...tree.querySelectorAll('.fm-tree-item')].map(i => i.dataset.path) : null,
      sidebarVisible: sidebar ? sidebar.offsetWidth > 0 : false,
      sidebarW: sidebar?.offsetWidth
    };
  })()`);
  check('此 AstroKnot 左侧目录树渲染', Array.isArray(fm.items) && fm.items.length >= 2 && fm.sidebarVisible, JSON.stringify(fm));

  // 9. 网格排列：一格一个图标不重叠
  const grid = await ev(`(() => {
    const CELL = 84, START = 8, SIZE = 80;
    const icons = [...document.querySelectorAll('#desktopIconsLayer .desktop-icon')];
    const cells = icons.map(i => ({
      col: Math.round((parseFloat(i.style.left) - START) / CELL),
      row: Math.round((parseFloat(i.style.top) - START) / CELL),
      left: parseFloat(i.style.left), top: parseFloat(i.style.top)
    }));
    const onGrid = cells.every(c => Math.abs(c.left - (START + c.col * CELL)) < 1 && Math.abs(c.top - (START + c.row * CELL)) < 1);
    const dup = new Set(cells.map(c => c.col + ',' + c.row)).size !== cells.length;
    let overlap = false;
    for (let a = 0; a < cells.length && !overlap; a++)
      for (let b = a + 1; b < cells.length; b++)
        if (Math.abs(cells[a].left - cells[b].left) < SIZE && Math.abs(cells[a].top - cells[b].top) < SIZE) { overlap = true; break; }
    return { gridMode: window.appState.dockGridMode, onGrid, dup, overlap, pos: cells.map(c => c.col + ',' + c.row) };
  })()`);
  check('网格排列一格一个不重叠', grid.gridMode === 'grid' && grid.onGrid && !grid.dup && !grid.overlap, JSON.stringify(grid));

  const pass = results.filter(Boolean).length;
  console.log(`\n=== ${pass}/${results.length} 通过 ===`);
  process.exit(pass === results.length ? 0 : 1);
};
