// 一次性：门闩标记 + 安全探针，判定 latch 行为
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

const probe = `(function () {
  function wait() {
    if (window.__storageReady) { window.__storageReady.then(function () { window.__storageSettled = true; }); }
    else { setTimeout(wait, 4); }
  }
  wait();
})();`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: probe });

await ev('location.reload(); "reloading"');
const samples = [];
for (let i = 0; i < 80; i++) {
  await new Promise(r => setTimeout(r, 100));
  try {
    const s = await Promise.race([
      ev(`(() => ({
        t: performance.now() | 0,
        hasAppState: !!window.appState,
        settled: !!window.__storageSettled,
        latchWaited: !!window.__latchWaited,
        latchReleased: !!window.__latchReleased,
        latchMissing: !!window.__latchMissing,
        shimReady: !!(window.ProjectFsShim && window.ProjectFsShim.isReady()),
        projects: (window.appState?.projects || []).length,
      }))()`),
      new Promise(r => setTimeout(() => r(null), 300)),
    ]);
    if (s) samples.push(s);
    if (samples.filter(x => x.hasAppState).length >= 6) break;
  } catch (e) { /* context 重建中 */ }
}
const first = samples.find(s => s.hasAppState);
console.log('appState 首现:', JSON.stringify(first, null, 1));
console.log('最终:', JSON.stringify(samples[samples.length - 1], null, 1));
ws.close();
