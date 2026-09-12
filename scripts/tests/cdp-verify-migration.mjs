// 重启后验证旧 localStorage 版本数据迁移 → 文件层
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
if (!page) { console.log('✗ 未找到平板页面'); process.exit(1); }
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
await sleep(2500);
const mig = await ev2(`(async () => {
  let g = '', b = '';
  try { g = await window.FSCore.readText('system/version-graphs-tmp/legacy-proj-x/.versiongraph/graph.json'); } catch (e) {}
  try { b = await window.FSCore.readText('system/version-graphs-tmp/legacy-proj-x/.versiongraph/blobs/abc123.json'); } catch (e) {}
  return { g, b, keyGone: !localStorage.getItem('astroknot_vgraph:legacy-proj-x'), blobGone: !localStorage.getItem('astroknot_vblob:legacy-proj-x:abc123') };
})()`);
console.log(mig.g && mig.keyGone && mig.b && mig.blobGone
  ? '✓ 旧 localStorage 版本数据已迁移到桌面同构文件层（重启后触发）'
  : '✗ 迁移失败: ' + JSON.stringify(mig).slice(0, 200));
await ev2(`window.FSCore.rmrf('system/version-graphs-tmp/legacy-proj-x')`);
ws.close();
process.exit(0);
