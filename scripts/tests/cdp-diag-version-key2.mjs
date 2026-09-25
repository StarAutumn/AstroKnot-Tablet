// 诊断2：验证 versionKey 与 folderPath 错位假设
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
  const FSCore = window.FSCore;
  // 1. 真实 versionKey（传当前项目 id）
  const proj = window.appState.currentProject || window.appState.projects?.find(p => p.data);
  const vg = await import('./modules/versionGraph/versionGraph.js');
  const key = await vg.getVersionKey(proj.id);
  o.push('真实 versionKey = ' + JSON.stringify(key));
  // 2. 该 key 下的版本图内容（走正式 API，与 UI 同路径）
  const g = await window.api.versionLoadGraph(key);
  const gg = g.graph;
  o.push('versionLoadGraph(key) → ' + (gg ? 'commits=' + (gg.commits || []).length + ' branches=' + (gg.branches || []).length : 'null（无数据）'));
  // 3. 数据根下 download/ 目录实际内容
  const dl = await FSCore.listDir('download').catch(e => 'listDir 失败: ' + e.message);
  if (Array.isArray(dl)) {
    o.push('download/: ' + (dl.length ? dl.map(i => i.name + (i.isDir ? '/' : '')).join(', ') : '空目录'));
    for (const it of dl.filter(i => i.isDir)) {
      try {
        const raw = await FSCore.readText('download/' + it.name + '/.versiongraph/graph.json');
        const dg = JSON.parse(raw);
        o.push('  download/' + it.name + '/.versiongraph → commits=' + (dg.commits || []).length + ' HEAD=' + (dg.HEAD ? dg.HEAD.id || 'obj' : 'null'));
      } catch (e) { o.push('  download/' + it.name + '/ → 无 .versiongraph/graph.json'); }
    }
  } else o.push('download/ ' + dl);
  // 4. projects/汽车智能网联个人知识库 旧图详情（对照）
  try {
    const raw = await FSCore.readText('projects/汽车智能网联个人知识库/.versiongraph/graph.json');
    const og = JSON.parse(raw);
    const cs = og.commits || [];
    o.push('旧图 projects/…/.versiongraph → commits=' + cs.length + ' 最新=' + (cs.length ? new Date(cs[cs.length - 1].time).toLocaleString() : '-'));
  } catch (e) { o.push('旧图读取失败: ' + e.message); }
  // 5. 项目对象上还有什么相关字段
  o.push('proj 字段: ' + Object.keys(proj).join(', '));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
