// 读探针日志（先断言探针存在，再取日志）
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
let ready = false;
for (let i = 0; i < 25; i++) { if (await ev2('!!window.__guideLog')) { ready = true; break; } await sleep(1000); }
if (!ready) { console.log('探针未生效（__guideLog 不存在）'); ws.close(); process.exit(1); }
await sleep(8000); // 覆盖 startGuideIfNeeded 的 2s 延迟流程

const log = await ev2(`({
  log: window.__guideLog,
  done: JSON.stringify(localStorage.getItem('astroknot_guide_done_v1.0.0')),
  firstRun: JSON.stringify(localStorage.getItem('astroknot_first_run')),
  overlay: (function () { var o = document.querySelector('#guideOverlay, .guide-overlay'); return o ? getComputedStyle(o).display : 'none-found'; })(),
})`);
console.log(JSON.stringify(log, null, 1));
ws.close();
setTimeout(() => process.exit(0), 500);
