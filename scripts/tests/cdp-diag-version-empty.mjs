// 诊断：版本时间线失灵——当前 versionKey 与磁盘 .versiongraph 实际状态对照
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
  // 1. 当前项目状态与 versionKey
  const proj = window.appState.currentProject || window.appState.projects?.find(p => p.data) || null;
  o.push('当前项目: ' + (proj ? JSON.stringify({ id: proj.id, name: proj.name, folderPath: proj.folderPath || null }) : '无'));
  try {
    const vg = await import('./modules/versionGraph/versionGraph.js');
    if (vg.getVersionKey) {
      const key = await vg.getVersionKey();
      o.push('getVersionKey() = ' + JSON.stringify(key));
    } else {
      o.push('versionGraph.js 导出: ' + Object.keys(vg).join(', '));
    }
  } catch (e) { o.push('getVersionKey 调用失败: ' + e.message); }
  // 2. projects/ 目录清单
  const items = await FSCore.listDir('projects').catch(e => [{ err: e.message }]);
  o.push('projects/ 目录: ' + items.map(i => i.name + (i.isDir ? '/' : '')).join(', '));
  // 3. 每个项目 .versiongraph 状态
  for (const it of items.filter(i => i.isDir)) {
    const dir = 'projects/' + it.name;
    let detail = '无 .versiongraph';
    try {
      const raw = await FSCore.readText(dir + '/.versiongraph/graph.json');
      const g = JSON.parse(raw);
      detail = 'commits=' + (g.commits || []).length + ' branches=' + (g.branches || []).length + ' HEAD=' + (g.HEAD || 'null');
    } catch (e) { detail = e.message.indexOf('404') >= 0 || /not.?found/i.test(e.message) ? '无 .versiongraph' : 'graph.json 读取异常: ' + e.message; }
    o.push('  ' + dir + ' → ' + detail);
  }
  // 4. 未保存项目 tmp
  const tmp = await FSCore.listDir('system/version-graphs-tmp').catch(() => []);
  o.push('system/version-graphs-tmp/: ' + (tmp.length ? tmp.map(t => t.name).join(', ') : '空'));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
