// 捕获 transitionActive=true 的赋值调用栈 + 观测标签重建速率
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
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await new Promise(r => setTimeout(r, 1000)); }
await new Promise(r => setTimeout(r, 1500));

console.log('装探针:', await ev2(`(() => {
  window.__tLog = [];
  let _v = appState.transitionActive;
  Object.defineProperty(appState, 'transitionActive', {
    configurable: true,
    get() { return _v; },
    set(nv) {
      if (nv !== _v) window.__tLog.push({ t: Date.now() % 100000, from: _v, to: nv, stack: (new Error().stack || '').split('\\n').slice(1, 5).join(' | ') });
      _v = nv;
    }
  });
  return true;
})()`));

// 观察 8s：每 2s 报告一次重建速率 + transition 状态
for (let w = 0; w < 4; w++) {
  const r = await ev2(`(async () => {
    const before = new Map();
    for (const [id, obj] of appState.nodeMeshes) if (obj.label) before.set(id, obj.label.material.map);
    const t0 = Date.now();
    await new Promise(r => setTimeout(r, 2000));
    let rebuilt = 0;
    for (const [id, obj] of appState.nodeMeshes) if (obj.label && before.has(id) && before.get(id) !== obj.label.material.map) rebuilt++;
    return { rebuilt, total: before.size, simple3D: appState.simple3D, tActive: appState.transitionActive, is2D: appState.is2DView, fpsGuess: +(rebuilt / ((Date.now() - t0) / 1000)).toFixed(1) };
  })()`);
  console.log(`窗口${w + 1}:`, JSON.stringify(r));
}

console.log('transitionActive 变更记录:', JSON.stringify(await ev2('window.__tLog'), null, 1));
ws.close();
setTimeout(() => process.exit(0), 300);
