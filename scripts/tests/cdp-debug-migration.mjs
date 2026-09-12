// 排查迁移失败原因
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

console.log('FSCore ready =', await ev2('window.FSCore ? window.FSCore.isReady() : "no FSCore"'));
console.log('旧键还在 =', await ev2(`!!localStorage.getItem('astroknot_vgraph:legacy-proj-x')`));
// version-shim 是新版吗（文件层后端日志特征字符串在加载日志里，直接看脚本内容标记）
console.log('version-shim 新版 =', await ev2(`(async () => {
  const r = await fetch('js/version-shim.js'); const t = await r.text();
  return t.includes('文件层后端');
})()`));
// 手动按迁移逻辑写同一文件
const manual = await ev2(`(async () => {
  try {
    await window.FSCore.writeText('system/version-graphs-tmp/legacy-proj-x/.versiongraph/graph.json', '{"commits":[{"id":"c1","time":1700000000000}],"branches":[{"name":"主线"}],"HEAD":"c1"}');
    const t = await window.FSCore.readText('system/version-graphs-tmp/legacy-proj-x/.versiongraph/graph.json');
    return '手动写入成功 len=' + t.length;
  } catch (e) { return '手动写入失败: ' + e.message; }
})()`);
console.log(manual);
// 手动执行与 migrateLegacy 相同的枚举逻辑
console.log('枚举旧键 =', await ev2(`(function(){const a=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.indexOf('astroknot_vgraph:')===0||k.indexOf('astroknot_vblob:')===0)a.push(k)}return JSON.stringify(a)})()`));
ws.close();
process.exit(0);
