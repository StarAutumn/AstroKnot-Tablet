// 检查 window.api.version* 的实际实现来源
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

console.log('versionSaveGraph 来源:\n', await ev2('window.api.versionSaveGraph ? window.api.versionSaveGraph.toString().slice(0, 300) : "未定义"'));
console.log('---');
console.log('FSCore.isReady =', await ev2('window.FSCore ? window.FSCore.isReady() : "no"'));
// 手动完整执行迁移等价逻辑
const manual = await ev2(`(async () => {
  const out = [];
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k.indexOf('astroknot_vgraph:') === 0 || k.indexOf('astroknot_vblob:') === 0)) keys.push(k);
  }
  out.push('枚举到旧键 ' + keys.length + ' 个');
  if (keys.includes('astroknot_vgraph:legacy-proj-x')) {
    try {
      await window.FSCore.writeText('system/version-graphs-tmp/legacy-proj-x/.versiongraph/graph.json', localStorage.getItem('astroknot_vgraph:legacy-proj-x'));
      localStorage.removeItem('astroknot_vgraph:legacy-proj-x');
      out.push('手动迁移 graph 成功');
    } catch (e) { out.push('手动迁移失败: ' + e.message); }
  }
  return out.join(' | ');
})()`);
console.log(manual);
ws.close();
process.exit(0);
