// 验证 2D/3D 切换按钮首次显示正确
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const ev2 = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await new Promise(r => setTimeout(r, 3000));
for (let i = 0; i < 20; i++) { const s = await ev2('!!window.appState'); if (s) break; await new Promise(r => setTimeout(r, 1000)); }
await new Promise(r => setTimeout(r, 2000));

// 1. 首次进入（3D 模式）按钮文字
const r1 = await ev2(`(() => {
  const el = document.getElementById('startPage'); if (el) el.style.display = 'none';
  const btn = document.getElementById('modeToggleBtn');
  return { text: btn ? btn.textContent : null, is2D: window.appState ? window.appState.is2DView : null };
})()`);
console.log('首次进入按钮:', JSON.stringify(r1));
// is2DView 无初始值（module0 未定义，切换时才赋值）——干净启动为 undefined，
// 语义即 3D（与桌面 `!appState.is2DView` 判定一致），故只排除 true
const ok1 = r1.text === '⑂ 2D' && r1.is2D !== true;
console.log((ok1 ? '✓ PASS' : '✗ FAIL') + '  3D 模式下按钮显示 ⑂ 2D（非天气符号）');

// 2. 切到 2D 再切回来
const r2 = await ev2(`(async () => {
  const app = await import('./modules/2DView/index.js');
  app.toggle2DView(); await new Promise(s => setTimeout(s, 900));
  const t1 = document.getElementById('modeToggleBtn').textContent;
  app.toggle2DView(); await new Promise(s => setTimeout(s, 900));
  const t2 = document.getElementById('modeToggleBtn').textContent;
  return { t1, t2 };
})()`);
console.log('切换后按钮:', JSON.stringify(r2));
const ok2 = r2.t1 === '🪐 3D' && r2.t2 === '⑂ 2D';
console.log((ok2 ? '✓ PASS' : '✗ FAIL') + '  2D/3D 往返切换按钮文字正确');
process.exit(ok1 && ok2 ? 0 : 1);
