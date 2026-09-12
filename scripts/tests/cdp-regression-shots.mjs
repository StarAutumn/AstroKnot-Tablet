// 视觉回归：2D/3D 截图 + 3D 标签可见性断言（防止 !simple3D 门控误伤极简模式标签）
import fs from 'node:fs';
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
await sleep(2000);

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`D:/AstroKnot-Tablet/scripts/tests/out-${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('截图:', name);
};

// 3D 模式（若在 2D 先切）
if (await ev2('appState.is2DView')) { await ev2(`(() => { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); return true; })()`); await sleep(2500); }
await sleep(1500);
const labelState = await ev2(`(() => {
  let visible = 0, withLabel = 0, hasTexture = 0;
  for (const [, obj] of appState.nodeMeshes) {
    if (obj.label) { withLabel++; if (obj.label.visible) visible++; if (obj.label.material?.map) hasTexture++; }
  }
  return { withLabel, visible, hasTexture, total: appState.nodeMeshes.size };
})()`);
console.log('3D 标签状态:', JSON.stringify(labelState));
await shot('3d');

// 2D 模式
await ev2(`(() => { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); return true; })()`);
await sleep(2500);
console.log('is2DView:', await ev2('appState.is2DView'));
await shot('2d');
ws.close();
setTimeout(() => process.exit(0), 300);
