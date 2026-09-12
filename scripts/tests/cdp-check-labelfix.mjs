// 验证真机 module14 是否含新缓存逻辑 + 探查 label sprite 缓存字段状态
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

console.log('module14 含 _lastBorder:', await ev2(`(async () => { const s = await (await fetch('/modules/module14_Animation.js')).text(); return { hasCache: s.includes('_lastBorder'), len: s.length }; })()`));
console.log('sprite 状态:', await ev2(`(() => {
  const out = { total: 0, withLabel: 0, withLastBorder: 0, sample: [], visible: 0 };
  for (const [id, obj] of appState.nodeMeshes) {
    out.total++;
    if (obj.label) { out.withLabel++; if (obj.label._lastBorder !== undefined) out.withLastBorder++; if (obj.label.visible) out.visible++; if (out.sample.length < 3) out.sample.push({ id, lastBorder: obj.label._lastBorder, visible: obj.label.visible, hasMap: !!obj.label.material?.map }); }
  }
  return out;
})()`));
// 计数 _setLabelVisible 每秒触发多少次重绘：wrap 无法达模块内部，改为观测 map.dispose 不可行；
// 用 Texture 实例计数近似：1 秒内 material.map 引用是否被换新（对比两次采样 identity）
console.log('1s 内纹理是否被重建:', await ev2(`(async () => {
  const before = new Map();
  for (const [id, obj] of appState.nodeMeshes) if (obj.label) before.set(id, obj.label.material.map);
  await new Promise(r => setTimeout(r, 1000));
  let rebuilt = 0, total = 0;
  for (const [id, obj] of appState.nodeMeshes) if (obj.label && before.has(id)) { total++; if (before.get(id) !== obj.label.material.map) rebuilt++; }
  return { rebuilt, total };
})()`));
ws.close();
setTimeout(() => process.exit(0), 300);
