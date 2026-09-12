// 端到端读回验证：运行时 API 读取迁移后的 .versiongraph/ 文件
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

const out = await ev2(`(async () => {
  const o = [];
  for (const key of ['projects/新知识网络', 'projects/新项目']) {
    const g = await window.api.versionLoadGraph(key);
    const commits = g.graph && g.graph.commits ? g.graph.commits.length : 0;
    o.push(key + ' → commits=' + commits + ' branches=' + (g.graph && g.graph.branches ? g.graph.branches.length : 0));
    if (commits > 0) {
      const h = g.graph.commits[commits - 1].snapshotHash;
      const blob = await window.api.versionLoadBlob(key, h);
      o.push('  snapshot blob 读取 = ' + (blob ? (blob.type === 'manifest' ? 'manifest(v2)' : '完整snapshot(v1)') : 'null'));
    }
  }
  // 写读删自检（临时 key，不碰用户数据）
  const tk = 'system/selftest-vg';
  await window.api.versionSaveGraph(tk, { commits: [{ id: 't1', time: Date.now() }], branches: [], HEAD: null });
  const rg = await window.api.versionLoadGraph(tk);
  await window.api.versionDeleteGraph(tk);
  o.push('自检 write/read/delete = ' + (rg.graph && rg.graph.commits.length === 1 ? '通过' : '失败'));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
