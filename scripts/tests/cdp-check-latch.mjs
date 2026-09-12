// 门闩时序取证：检查 __latch* 标志位 + WebView 版本 + 当前 guide 状态
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }

const r = await ev2(String.raw`({
  latchWaited: !!window.__latchWaited,
  latchReleased: !!window.__latchReleased,
  latchMissing: !!window.__latchMissing,
  ua: navigator.userAgent,
  ssfKeyCount: window.SystemStorageFs ? window.SystemStorageFs.getMap().size : -1,
  guideKeysInMap: window.SystemStorageFs ? Array.from(window.SystemStorageFs.getMap().keys()).filter(function (k) { return /guide/i.test(k); }) : [],
  overlayVisible: (function () { var o = document.getElementById('guideOverlay'); return o ? getComputedStyle(o).display !== 'none' : false; })(),
})`);
console.log(JSON.stringify(r, null, 2));
ws.close();
setTimeout(() => process.exit(0), 300);
