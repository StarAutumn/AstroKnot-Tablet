// 验证桌面图标触摸拖动：长按后拖动（新）+ 按下即拖（回归）+ 长按不动=菜单（回归）
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
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
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? '✓ PASS' : '✗ FAIL') + '  ' + name + (detail ? '  — ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await new Promise(r => setTimeout(r, 3000));
for (let i = 0; i < 30; i++) { const s = await ev2('!!window.appState'); if (s) break; await new Promise(r => setTimeout(r, 1000)); }
await sleep(2500); // 启动期重渲染稳定

// 关闭启动首页（若显示）
await ev2(`(() => { const el = document.getElementById('startPage'); if (el) el.style.display = 'none'; return true; })()`);
await sleep(300);

const state = await ev2(`(() => {
  const icons = [...document.querySelectorAll('.desktop-icon')];
  return icons.map(i => ({ id: i.dataset.appId, left: parseFloat(i.style.left) || 0, top: parseFloat(i.style.top) || 0 }));
})()`);
console.log('当前图标:', JSON.stringify(state));
if (state.length < 2) { console.log('✗ 图标不足，无法测试'); process.exit(1); }

// 合成 Touch 事件序列
const fire = `(() => {
  window.__fireTouch = function (el, type, x, y) {
    const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [t],
      targetTouches: type === 'touchend' ? [] : [t],
      changedTouches: [t],
    }));
  };
  return true;
})()`;
await ev2(fire);

// ── 1. 长按后拖动 ──
const r1 = await ev2(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const icon = document.querySelector('.desktop-icon');
  const r = icon.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const origLeft = parseFloat(icon.style.left);
  window.__fireTouch(icon, 'touchstart', cx, cy);
  await sleep(650); // 触发长按菜单
  const menuOpen = !!document.querySelector('.dock-context-menu');
  // 长按后开始拖动
  window.__fireTouch(icon, 'touchmove', cx + 25, cy); await sleep(60);
  window.__fireTouch(icon, 'touchmove', cx + 120, cy); await sleep(60);
  window.__fireTouch(icon, 'touchmove', cx + 230, cy); await sleep(60);
  const menuAfterDrag = !!document.querySelector('.dock-context-menu');
  window.__fireTouch(icon, 'touchend', cx + 230, cy);
  await sleep(300);
  const newLeft = parseFloat(icon.style.left);
  return { menuOpen, menuAfterDrag, origLeft, newLeft, moved: Math.abs(newLeft - origLeft) > 50 };
})()`);
check('长按触发菜单', r1.menuOpen === true, JSON.stringify(r1));
check('长按拖动后菜单自动关闭', r1.menuOpen && r1.menuAfterDrag === false, 'after=' + r1.menuAfterDrag);
check('长按拖动图标移位', r1.moved === true, 'orig=' + r1.origLeft + ' new=' + r1.newLeft);

// ── 2. 按下即拖（回归） ──
const r2 = await ev2(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const icon = document.querySelector('.desktop-icon');
  const r = icon.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const origLeft = parseFloat(icon.style.left);
  window.__fireTouch(icon, 'touchstart', cx, cy);
  await sleep(40); // 立即拖动（<550ms，不触发长按）
  window.__fireTouch(icon, 'touchmove', cx + 60, cy); await sleep(50);
  window.__fireTouch(icon, 'touchmove', cx + 200, cy); await sleep(50);
  window.__fireTouch(icon, 'touchend', cx + 200, cy);
  await sleep(300);
  const newLeft = parseFloat(icon.style.left);
  return { origLeft, newLeft, moved: Math.abs(newLeft - origLeft) > 50 };
})()`);
check('按下即拖仍工作（回归）', r2.moved === true, 'orig=' + r2.origLeft + ' new=' + r2.newLeft);

// ── 3. 长按不动 = 菜单（回归） ──
const r3 = await ev2(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const icon = document.querySelector('.desktop-icon');
  const r = icon.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const origLeft = parseFloat(icon.style.left);
  window.__fireTouch(icon, 'touchstart', cx, cy);
  await sleep(650);
  const menuOpen = !!document.querySelector('.dock-context-menu');
  window.__fireTouch(icon, 'touchend', cx, cy);
  await sleep(200);
  const newLeft = parseFloat(icon.style.left);
  return { menuOpen, origLeft, newLeft, stayed: Math.abs(newLeft - origLeft) < 5 };
})()`);
check('长按不动仍弹菜单（回归）', r3.menuOpen === true, JSON.stringify(r3));
check('长按不动图标不移位（回归）', r3.stayed === true, 'orig=' + r3.origLeft + ' new=' + r3.newLeft);

// 收尾：关闭可能残留的菜单
await ev2(`(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); const m = document.querySelector('.dock-context-menu'); if (m) m.remove(); return true; })()`);

const pass = results.filter(Boolean).length;
console.log(`\n=== ${pass}/${results.length} 通过 ===`);
process.exit(pass === results.length ? 0 : 1);
