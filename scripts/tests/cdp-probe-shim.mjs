// 临时探针：运行页面 touch-gestures.js 版本 + shared3D import 结果
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

const src = await ev2(`fetch('/js/touch-gestures.js?b=' + Date.now()).then(r => r.text())`);
console.log('长度:', src.length);
console.log('含 dragRelay:', src.includes('dragRelay'));
console.log('含 loadShared3D:', src.includes('loadShared3D'));

const imp = await ev2(`import('./modules/MoveMode/shared.js').then(m => 'ok drag3DNode=' + m.drag3DNode).catch(e => 'FAIL: ' + (e.message || e))`);
console.log('import shared.js:', imp);

// 经典脚本内动态 import 的解析基準与页面一致，直接再验一次完整 URL
const imp2 = await ev2(`import('https://localhost/js/../modules/MoveMode/shared.js').then(() => 'url-ok').catch(e => 'url-FAIL: ' + e.message)`);
console.log('完整URL import:', imp2);

await sleep(3000); // 等启动期 warm-up
const dbg = await ev2(`window.__shimDbg ? JSON.stringify(window.__shimDbg()) : 'no __shimDbg'`);
console.log('垫片闭包状态:', dbg);

ws.close();
setTimeout(() => process.exit(0), 300);
