// 验证慢双击重命名移除：部署文件含补丁 + 2D 节点慢双击实测
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(1500);

// 1. 部署文件静态校验（7 处 if (false &&）
const files = [
  '/modules/2DView/interaction/mouse-events.js',
  '/modules/VisualComponents/nodes/interaction.js',
  '/modules/module2_TreeData.js',
  '/modules/LayerManager/index.js',
  '/modules/AppLibrary/AppPanel.js',
  '/modules/module11_QuickNotes.js',
];
const counts = await ev2(`(async () => {
  const out = {};
  for (const f of ${JSON.stringify(files)}) {
    const s = await (await fetch(f)).text();
    out[f] = (s.match(/if \\(false && /g) || []).length;
  }
  return out;
})()`);
console.log('补丁命中数:', JSON.stringify(counts));
const expect = { '/modules/AppLibrary/AppPanel.js': 2 };
const bad = files.filter(f => counts[f] !== (expect[f] || 1));
if (bad.length) { console.log('✗ 以下文件补丁缺失:', bad); ws.close(); process.exit(1); }

// 2. 打开开发历程 + 进 2D
const opened = await ev2(`(async () => {
  const target = appState.projects.find(p => p.folderPath === 'projects/开发历程');
  if (target && appState.currentProjectId !== target.id) {
    const m2 = await import('./modules/module2_TreeData.js');
    m2.loadProject(target.id);
    await new Promise(r => setTimeout(r, 2500));
  }
  const sp = document.getElementById('startPage');
  if (sp && getComputedStyle(sp).display !== 'none') {
    const m = await import('./modules/StartPage/index.js');
    if (m.hideStartPage) { m.hideStartPage(); await new Promise(r => setTimeout(r, 800)); }
  }
  if (!window.appState.is2DView) { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); await new Promise(r => setTimeout(r, 1500)); }
  return { cur: appState.currentProjectId, is2D: appState.is2DView, nodes: appState.nodeMap.size };
})()`);
console.log('打开:', JSON.stringify(opened));

// 3. 慢双击实测：取一个普通节点中心，间隔 800ms 两次 tap → 不应出现重命名 input
const result = await ev2(`(async () => {
  const canvas = document.getElementById('view2dCanvas');
  const rect = canvas.getBoundingClientRect();
  // 找视口内的第一个普通（非 card）节点
  const t = await import('./modules/2DView/shared.js');
  const worldToScreen = (x, y) => ({
    sx: rect.left + canvas.width / 2 + (x * t.transform.scale + t.transform.offsetX),
    sy: rect.top + canvas.height / 2 + (y * t.transform.scale + t.transform.offsetY),
  });
  // 从命中区直接取（draw 后有效）：借用 appState 不可达，改用任意节点位置遍历 positions2D
  let target = null;
  for (const [id, pos] of appState.positions2D) {
    const n = appState.nodeMap.get(id);
    if (n && n.displayMode !== 'card' && n.name) { target = { id, x: pos.x, y: pos.y, name: n.name }; break; }
  }
  if (!target) return { ok: false, err: '无可用节点' };
  const p = worldToScreen(target.x, target.y);
  const cx = Math.max(rect.left + 5, Math.min(rect.right - 5, p.sx));
  const cy = Math.max(rect.top + 5, Math.min(rect.bottom - 5, p.sy));
  const tap = (x, y) => {
    const el = document.elementFromPoint(x, y) || canvas;
    for (const type of ['touchstart', 'touchend']) {
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: type === 'touchstart' ? [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })] : [],
        changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })] }));
    }
  };
  tap(cx, cy);
  await new Promise(r => setTimeout(r, 800));
  tap(cx, cy);
  await new Promise(r => setTimeout(r, 600));
  const input = document.querySelector('input[type="text"][style*="position:fixed"], #renameInput, .rename-input');
  const overlayInputs = [...document.querySelectorAll('input')].filter(i => i.style.position === 'fixed');
  return { ok: true, node: target.name, renameInputShown: !!(input || overlayInputs.length) };
})()`);
console.log('慢双击实测:', JSON.stringify(result));
console.log(result.renameInputShown === false ? '✓ 通过：慢双击未触发重命名' : '✗ 失败：出现重命名输入框');
ws.close();
setTimeout(() => process.exit(result.renameInputShown === false ? 0 : 1), 300);
