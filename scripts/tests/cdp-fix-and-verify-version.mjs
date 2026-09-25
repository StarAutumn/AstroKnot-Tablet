// 修复+终验：download/ 新项目版本图迁移 + folderPath 修正 + 保存事件链路端到端验证
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState && window.FSCore && window.FSCore.isReady()')) break; await sleep(1000); }

const out = await ev2(`(async () => {
  const o = [];
  const FSCore = window.FSCore;
  const dirs = (await FSCore.listDir('projects')).filter(d => d.isDir).map(d => d.name);
  o.push('projects/ 目录: ' + dirs.join(', '));
  // ── 1. 迁移 download/<名>.astroknot/.versiongraph → projects/<名>/.versiongraph（目标不存在时才迁） ──
  const dl = await FSCore.listDir('download').catch(() => []);
  for (const d of dl.filter(x => x.isDir)) {
    const projName = d.name.replace(/\\.astroknot$/, '');
    const target = dirs.find(n => n === projName);
    if (!target) { o.push('跳过 download/' + d.name + '（projects/ 无同名项目，保留）'); continue; }
    let srcRaw = null;
    try { srcRaw = await FSCore.readText('download/' + d.name + '/.versiongraph/graph.json'); } catch (_) {}
    if (!srcRaw) { o.push('跳过 download/' + d.name + '（无版本图）'); continue; }
    let tgtRaw = null;
    try { tgtRaw = await FSCore.readText('projects/' + target + '/.versiongraph/graph.json'); } catch (_) {}
    if (tgtRaw) { o.push('跳过 download/' + d.name + '（目标已有版本图，保留源）'); continue; }
    const srcBlobs = (await FSCore.listDir('download/' + d.name + '/.versiongraph/blobs').catch(() => [])) || [];
    await FSCore.writeText('projects/' + target + '/.versiongraph/graph.json', srcRaw);
    for (const b of srcBlobs.filter(x => !x.isDir)) {
      const c = await FSCore.readText('download/' + d.name + '/.versiongraph/blobs/' + b.name);
      await FSCore.writeText('projects/' + target + '/.versiongraph/blobs/' + b.name, c);
    }
    o.push('✓ 迁移 download/' + d.name + '/.versiongraph → projects/' + target + '/.versiongraph（graph + ' + srcBlobs.filter(x => !x.isDir).length + ' blobs）');
  }
  // ── 2. 内存 folderPath 修正 ──
  const seen = new Set();
  for (const p of (window.appState.projects || []).concat(window.appState.currentProject || [])) {
    if (!p || seen.has(p.id)) continue; seen.add(p.id);
    const fp = String(p.folderPath || '');
    if (fp.indexOf('download/') === 0) {
      const cand = dirs.find(n => n === (fp.split('/')[1] || '').replace(/\\.astroknot$/, '') || n === p.name);
      if (cand) { p.folderPath = 'projects/' + cand; o.push('✓ folderPath 修正 [' + p.name + '] → ' + p.folderPath); }
    }
  }
  // ── 3. 端到端终验：打开项目 → 派发保存事件 → 自动提交 ──
  const vg = await import('./modules/versionGraph/versionGraph.js');
  let pid = window.appState.currentProjectId;
  if (!pid) {
    // 启动首页状态：自动打开第一个项目以复现"项目内保存"场景
    const m2 = await import('./modules/module2_TreeData.js');
    const first = (window.appState.projects || [])[0];
    if (!first) return o.join('\\n') + '\\n✗ 无可打开项目';
    const sp = await import('./modules/StartPage/index.js');
    if (sp.hideStartPage) sp.hideStartPage();
    await m2.loadProject(first.id);
    await new Promise(r => setTimeout(r, 2500));
    pid = window.appState.currentProjectId;
    o.push('自动打开项目 [' + first.name + '] id=' + pid);
  }
  const key = vg.getVersionKey(pid);
  o.push('当前项目 versionKey = ' + JSON.stringify(key));
  const n0 = ((await vg.getGraph(pid)).commits || []).length;
  o.push('保存前 commits = ' + n0);
  window.dispatchEvent(new CustomEvent('astroknot-project-saved'));
  await new Promise(r => setTimeout(r, 4000));
  const n1 = ((await vg.getGraph(pid)).commits || []).length;
  o.push('派发保存事件后 commits = ' + n1 + (n1 > n0 ? ' ✓✓ 自动提交链路已打通' : ' ✗ 仍无提交（需看 console）'));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
