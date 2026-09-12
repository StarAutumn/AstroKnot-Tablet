// 读存储初始化链状态：门闩结果、根目录、降级标记
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) return { JS_EXCEPTION: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result?.value;
};
for (let i = 0; i < 25; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(2000);

const st = await ev2(`(async function () {
  var out = {
    fscDir: window.FSCore ? window.FSCore.dir() : 'no-fsc',
    fscReady: window.FSCore ? window.FSCore.isReady() : 'no-fsc',
    ssfReady: window.SystemStorageFs ? window.SystemStorageFs.isReady() : 'no-ssf',
    ssfFailed: window.SystemStorageFs ? window.SystemStorageFs.isFailed() : 'no-ssf',
    mapSize: window.SystemStorageFs ? window.SystemStorageFs.getMap().size : 'no-ssf',
    pfsDegraded: window.ProjectFsShim ? (window.ProjectFsShim._degraded || false) : 'no-pfs',
    guideDone: (function () { var r = window.api.systemStorageReadSync('astroknot_guide_done_v1.0.0'); return r && r.success ? r.value : 'NOT_FOUND'; })(),
    firstRun: (function () { var r = window.api.systemStorageReadSync('astroknot_first_run'); return r && r.success ? r.value : 'NOT_FOUND'; })(),
    settings: (function () { var r = window.api.systemStorageReadSync('astroknot_settings'); return r && r.success ? ('len:' + String(r.value).length) : 'NOT_FOUND'; })(),
  };
  try { await window.__storageReady; out.storageReadyResolved = true; }
  catch (e) { out.storageReadyResolved = false; out.storageReadyError = String(e && e.message || e); }
  return out;
})()`);
console.log(JSON.stringify(st, null, 1));
ws.close();
setTimeout(() => process.exit(0), 500);
