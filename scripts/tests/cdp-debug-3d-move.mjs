// 临时调试：3D 移动模式拖拽接力分步观察
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

await ev2(`(async () => {
  const sp = document.getElementById('startPage');
  if (sp && sp.style.display !== 'none') { const m = await import('./modules/StartPage/index.js'); if (m.hideStartPage) m.hideStartPage(); }
  if (window.appState.is2DView) { document.getElementById('modeToggleBtn').click(); }
  return true;
})()`);
await sleep(1200);

// 选节点
const node = await ev2(`(() => {
  const cam = window.appState.camera;
  const rect = window.appState.renderer.domElement.getBoundingClientRect();
  for (const [nid, pos] of window.appState.positions) {
    const p = pos.clone().project(cam);
    if (Math.abs(p.x) < 0.5 && Math.abs(p.y) < 0.5 && p.z < 1) return { id: nid, x: Math.round(rect.left + (p.x + 1) / 2 * rect.width), y: Math.round(rect.top + (-p.y + 1) / 2 * rect.height) };
  }
  return null;
})()`);
console.log('节点:', JSON.stringify(node));

// 挂观察监听器（canvas + window）
await ev2(`(() => {
  window.__dbg = { ev: [], err: [] };
  window.addEventListener('error', e => window.__dbg.err.push(e.message));
  const cv = window.appState.renderer.domElement;
  for (const t of ['pointerdown', 'mousemove', 'mouseup', 'click', 'contextmenu']) {
    cv.addEventListener(t, (e) => window.__dbg.ev.push(t + '@' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ' b' + e.button + (e.isTrusted ? ' T' : ' S')), true);
  }
  window.addEventListener('mouseup', (e) => window.__dbg.ev.push('win.mouseup@' + Math.round(e.clientX ?? -1)), true);
  return true;
})()`);

// 进入移动模式
await ev2(`(async () => {
  const m = await import('./modules/MoveMode/move-mode/move-core.js');
  m.enterMoveMode(${JSON.stringify(node.id)});
  return true;
})()`);
await sleep(300);

// 步骤1: pointerdown → 立即读桌面拖拽状态
const st1 = await ev2(`(async () => {
  const cv = window.appState.renderer.domElement;
  const rect = cv.getBoundingClientRect();
  const cx = rect.left + ${node.x}, cy = rect.top + ${node.y};
  cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 7, pointerType: 'touch', isPrimary: true }));
  await new Promise(r => setTimeout(r, 80));
  const s = await import('./modules/MoveMode/shared.js');
  return { drag3DNode: s.drag3DNode, moveTargetId: s.moveTargetId, isMoveMode: s.isMoveMode, hitId: (s.moveTargetId === '${node.id}') };
})()`);
console.log('pointerdown 后:', JSON.stringify(st1));

// 决定性实验：touchstart 后静止保持 750ms
//   relay 未武装 → 550ms 长按定时器触发 → canvas contextmenu 弹出
//   relay 已武装 → 长按被吞，无任何菜单
await ev2(`(async () => {
  const cv = window.appState.renderer.domElement;
  const rect = cv.getBoundingClientRect();
  const t = new Touch({ identifier: 7, target: cv, clientX: rect.left + ${node.x}, clientY: rect.top + ${node.y} });
  cv.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(750);
const holdProbe = await ev2(`(() => {
  const nodeMenu = document.getElementById('nodeContextMenu');
  const blankMenu = document.getElementById('blankContextMenu');
  const grpMenu = document.getElementById('groupContextMenu');
  const vis = (el) => el && el.style.display === 'flex';
  return { nodeMenu: vis(nodeMenu), blankMenu: vis(blankMenu), grpMenu: vis(grpMenu) };
})()`);
console.log('静止保持 750ms 后菜单:', JSON.stringify(holdProbe), holdProbe.nodeMenu || holdProbe.blankMenu ? '← relay 未武装（长按触发）' : '← relay 已武装（长按被吞）');
// 收尾这次触摸
await ev2(`(async () => {
  const cv = window.appState.renderer.domElement;
  const rect = cv.getBoundingClientRect();
  const t = new Touch({ identifier: 7, target: cv, clientX: rect.left + ${node.x}, clientY: rect.top + ${node.y} });
  cv.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(200);
dbg = await ev2(`({ ev: window.__dbg.ev.slice(), err: window.__dbg.err.slice() })`);
console.log('保持实验后事件:', JSON.stringify(dbg.ev.slice(-6)));

// 步骤2: touchstart → 检查 relay 是否吃进（间接：mousemove 是否被派发）
await ev2(`(async () => {
  const fire = (type, x, y) => {
    const cv = window.appState.renderer.domElement;
    const rect = cv.getBoundingClientRect();
    const t = new Touch({ identifier: 7, target: cv, clientX: rect.left + x, clientY: rect.top + y });
    cv.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
  };
  fire('touchstart', ${node.x}, ${node.y});
  return true;
})()`);
await sleep(100);
let dbg = await ev2(`({ ev: window.__dbg.ev.slice(), err: window.__dbg.err.slice() })`);
console.log('touchstart 后事件:', JSON.stringify(dbg));

// 步骤3: touchmove 序列 → 观察节点位移
const pos0 = await ev2(`(() => { const p = window.appState.positions.get(${JSON.stringify(node.id)}); return { x: p.x, y: p.y, z: p.z }; })()`);
for (const f of [0.5, 1]) {
  const fx = Math.round(node.x + 160 * f), fy = Math.round(node.y + 110 * f);
  await ev2(`(async () => {
    const cv = window.appState.renderer.domElement;
    const rect = cv.getBoundingClientRect();
    const t = new Touch({ identifier: 7, target: cv, clientX: rect.left + ${fx}, clientY: rect.top + ${fy} });
    cv.dispatchEvent(new TouchEvent('touchmove', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(100);
}
const pos1 = await ev2(`(() => { const p = window.appState.positions.get(${JSON.stringify(node.id)}); return { x: p.x, y: p.y, z: p.z }; })()`);
console.log('位移:', JSON.stringify({ pos0, pos1 }));

// 步骤4: touchend → 收尾
await ev2(`(async () => {
  const cv = window.appState.renderer.domElement;
  const rect = cv.getBoundingClientRect();
  const t = new Touch({ identifier: 7, target: cv, clientX: rect.left + ${node.x + 160}, clientY: rect.top + ${node.y + 110} });
  cv.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
  return true;
})()`);
await sleep(300);
dbg = await ev2(`({ ev: window.__dbg.ev.slice(), err: window.__dbg.err.slice() })`);
console.log('全部事件:', JSON.stringify(dbg.ev, null, 1));
if (dbg.err.length) console.log('错误:', JSON.stringify(dbg.err));

// 清理：退出移动模式不保存
await ev2(`(async () => { const m = await import('./modules/MoveMode/move-mode/move-core.js'); m.exitMoveMode(false); return true; })()`);
ws.close();
setTimeout(() => process.exit(0), 300);
