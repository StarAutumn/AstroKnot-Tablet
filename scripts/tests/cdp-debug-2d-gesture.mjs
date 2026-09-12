// 临时调试：分步执行 2D 长按手势，观察合成事件链在哪一环断掉
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.type === 'page' && p.url.startsWith('https://localhost'));
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await ev2(`(() => { if (!window.appState.is2DView) { document.getElementById('modeToggleBtn').click(); } return true; })()`);
await sleep(1200);
await ev2(`window.appState.zoom2D(0.6)`);
await sleep(300);

// 取一个空白点（不在任何节点上）且在屏幕内
const pt = await ev2(`(async () => {
  const shared = await import('./modules/2DView/shared.js');
  const cv = document.getElementById('view2dCanvas');
  const el = document.elementFromPoint(innerWidth * 0.3, innerHeight * 0.3);
  return {
    blankX: Math.round(innerWidth * 0.3), blankY: Math.round(innerHeight * 0.3),
    elAt: el ? (el.id || el.tagName + (el.className && el.className.baseVal !== undefined ? '.' + el.className.baseVal : '.' + el.className)) : 'null',
    in2DContainer: !!(el && el.closest && el.closest('#view2dContainer')),
    shared2Dok: !!shared && !!shared.transform,
    canvasRect: cv ? cv.getBoundingClientRect().toJSON() : null,
    canvasSize: cv ? { w: cv.width, h: cv.height } : null
  };
})()`);
console.log('空白点信息:', JSON.stringify(pt, null, 1));

// 挂观察监听器
await ev2(`(() => {
  window.__dbg = { events: [], errors: [] };
  const rec = (name) => (e) => window.__dbg.events.push(name + '@' + Math.round(e.clientX ?? -1) + ',' + Math.round(e.clientY ?? -1));
  const cv = document.getElementById('view2dCanvas');
  cv.addEventListener('mousedown', rec('cv.mousedown'), true);
  cv.addEventListener('contextmenu', rec('cv.contextmenu'), true);
  window.addEventListener('mousemove', rec('win.mousemove'), true);
  window.addEventListener('mouseup', rec('win.mouseup'), true);
  window.addEventListener('error', (e) => window.__dbg.errors.push(e.message + ' @ ' + (e.filename||'') + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => window.__dbg.errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  return true;
})()`);

const X = pt.blankX, Y = pt.blankY;
const fire = `(type, x, y) => {
  const tgt = document.elementFromPoint(x, y) || document.body;
  const t = new Touch({ identifier: 9, target: tgt, clientX: x, clientY: y });
  document.dispatchEvent(new TouchEvent(type, { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
}`;

// 步骤1: touchstart + 长按 700ms（不移动）
await ev2(`(async () => { const fire = ${fire}; fire('touchstart', ${X}, ${Y}); return true; })()`);
await sleep(750);
let st = await ev2(`({ events: window.__dbg.events.slice(), errors: window.__dbg.errors.slice(), selecting: null })`);
console.log('长按 750ms 后事件:', JSON.stringify(st.events));
if (st.errors.length) console.log('JS 错误:', JSON.stringify(st.errors));

// 检查桌面 boxSelecting 状态
const selState = await ev2(`(async () => {
  const shared = await import('./modules/2DView/shared.js');
  return { isBoxSelecting: shared.isBoxSelecting, canvasStart: shared.boxSelectCanvasStart ? { x: Math.round(shared.boxSelectCanvasStart.x), y: Math.round(shared.boxSelectCanvasStart.y) } : null };
})()`);
console.log('桌面框选状态:', JSON.stringify(selState));

// 步骤2: 拖动
for (const [dx, dy] of [[80, 60], [160, 120], [240, 180]]) {
  await ev2(`(async () => { const fire = ${fire}; fire('touchmove', ${X + dx}, ${Y + dy}); return true; })()`);
  await sleep(120);
}
await ev2(`(async () => { const fire = ${fire}; fire('touchend', ${X + 240}, ${Y + 180}); return true; })()`);
await sleep(600);
st = await ev2(`({ events: window.__dbg.events.slice(), errors: window.__dbg.errors.slice() })`);
console.log('拖动+松手后事件数:', st.events.length, JSON.stringify(st.events.slice(0, 12)));
if (st.errors.length) console.log('JS 错误:', JSON.stringify(st.errors));
console.log('选中数:', await ev2('window.appState.selectedNodeIds ? window.appState.selectedNodeIds.size : -1'));

ws.close();
setTimeout(() => process.exit(0), 300);
