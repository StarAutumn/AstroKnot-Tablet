// 验证 SystemStorageFs 运行时状态：init 是否被调、map 是否为空
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
for (let i = 0; i < 25; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(3000);

const st = await ev2(`({
  ssfReady: window.SystemStorageFs ? window.SystemStorageFs.isReady() : 'no-ssf',
  ssfFailed: window.SystemStorageFs ? window.SystemStorageFs.isFailed() : 'no-ssf',
  mapSize: window.SystemStorageFs ? window.SystemStorageFs.getMap().size : 'no-ssf',
  mapHasFirstRun: window.SystemStorageFs ? window.SystemStorageFs.has('astroknot_first_run') : 'no-ssf',
  mapHasGuideDone: window.SystemStorageFs ? window.SystemStorageFs.has('astroknot_guide_done_v1.0.0') : 'no-ssf',
  firstRunViaApi: (function () { var r = window.api.systemStorageReadSync('astroknot_first_run'); return JSON.stringify(r); })(),
  guideViaApi: (function () { var r = window.api.systemStorageReadSync('astroknot_guide_done_v1.0.0'); return JSON.stringify(r); })(),
  firstRunViaLs: JSON.stringify(localStorage.getItem('astroknot_first_run')),
  fscReady: window.FSCore ? window.FSCore.isReady() : 'no-fsc',
})`);
console.log(JSON.stringify(st, null, 1));
ws.close();
setTimeout(() => process.exit(0), 500);
