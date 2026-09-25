// 数据修复 v2：修正运行时内存 appState 中的错位 folderPath（download/<名>.astroknot → projects/<名>）
// 依据：项目清单=启动扫 projects/ + 运行时内存；写盘路径由项目名决定（一直正确），
//       仅内存 folderPath 错位 → 改内存即可，重启后预载扫描天然给出正确路径
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
  const dirs = (await FSCore.listDir('projects')).filter(d => d.isDir).map(d => d.name);
  o.push('projects/ 实际目录: ' + dirs.join(', '));
  // ── 1. 修正内存 folderPath（目录必须真实存在且含 project.json） ──
  const all = (window.appState.projects || []);
  if (window.appState.currentProject) all.push(window.appState.currentProject);
  let changed = 0;
  const seen = new Set();
  for (const p of all) {
    if (!p || seen.has(p.id)) continue; seen.add(p.id);
    const fp = String(p.folderPath || '');
    o.push('条目 ' + p.name + ' (id=' + p.id + ') folderPath=' + (fp || '空'));
    if (fp.indexOf('download/') !== 0) continue;
    const cand = dirs.find(d => d === (fp.split('/')[1] || '').replace(/\\.astroknot$/, '') || d === p.name);
    if (!cand) { o.push('  ✗ 无对应 projects/ 目录，跳过'); continue; }
    const ok = await FSCore.readText('projects/' + cand + '/project.json').then(r => { JSON.parse(r); return true; }).catch(() => false);
    if (!ok) { o.push('  ✗ projects/' + cand + '/project.json 缺失或损坏，跳过'); continue; }
    p.folderPath = 'projects/' + cand;
    changed++;
    o.push('  ✓ 修正 → ' + p.folderPath);
  }
  if (!changed) o.push('（无 download/ 错位条目或均已修正）');
  // ── 2. 验证：正式链路读回时间线 ──
  const vg = await import('./modules/versionGraph/versionGraph.js');
  const proj = window.appState.currentProject;
  if (proj) {
    const key = await vg.getVersionKey(proj.id);
    o.push('修复后 getVersionKey = ' + JSON.stringify(key));
    const g = await window.api.versionLoadGraph(key);
    o.push('时间线读回 → commits=' + (g.graph ? (g.graph.commits || []).length : 'null') + (g.graph && (g.graph.commits || []).length ? '，最新=' + new Date(g.graph.commits[g.graph.commits.length - 1].time).toLocaleString() : ''));
  }
  // ── 3. download/ 残留报告（只报告不删） ──
  const dl = await FSCore.listDir('download').catch(() => []);
  o.push('download/ 残留（未动）: ' + (dl.length ? dl.map(d => d.name).join(', ') : '空'));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
