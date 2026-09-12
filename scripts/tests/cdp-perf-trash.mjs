// 回收站性能实测：桥调用基线 / listTrash / moveProjectToTrash（rename 与数据写入两条路径）
// / restoreFromTrash / permanentlyDeleteTrashItem，全部走独立临时项目，结束清理
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

for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState && !!window.api')) break; await sleep(1000); }
await ev2('window.__storageReady || Promise.resolve()');
await sleep(1000);

const timing = async (label, expr) => {
  const t0 = Date.now();
  const r = await ev2(`(async () => { const t0 = performance.now(); const r = (${expr}); if (r && r.then) await r; return { ms: Math.round(performance.now() - t0), r: r && typeof r === 'object' ? JSON.stringify(r).slice(0, 200) : String(r) }; })()`);
  console.log(label.padEnd(46), r.ms + 'ms', r.r || '');
  return r;
};

// ── 0. 环境信息 ──
console.log('存储根:', await ev2(`window.FSCore.dir() + '/' + window.FSCore.base()`),
  ' native=', await ev2('window.FSCore.isNative()'));

// ── 1. 桥调用基线（10 次串行 stat）──
const base = await ev2(`(async () => {
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) await window.FSCore.stat('projects');
  return Math.round((performance.now() - t0) / 10);
})()`);
console.log('桥调用基线 stat(projects) x10 平均'.padEnd(46), base + 'ms/次');

// ── 2. listTrash 冷/热 ──
await timing('listTrash #1（冷）', `window.api.listTrash()`);
await timing('listTrash #2（热）', `window.api.listTrash()`);

// ── 3. 造临时项目（project.json + 5 个节点文件）──
const mk = await ev2(`(async () => {
  const dir = 'projects/tmp-trash-perf';
  await window.FSCore.ensureDir(dir + '/nodes');
  const nodes = {};
  for (let i = 0; i < 5; i++) {
    const nid = 'T' + Date.now().toString(36) + i;
    nodes[nid] = 'x'.repeat(20000);
  }
  const pj = { id: 'proj_tmpperf', projectName: 'tmp-trash-perf', methodsTree: { id: 'root', name: '根', children: [] }, nodeRichContents: nodes, positions2D: {}, positions: {} };
  await window.FSCore.writeText(dir + '/project.json', JSON.stringify(pj));
  return true;
})()`);
console.log('临时项目已建:', mk);

// ── 4. moveProjectToTrash（rename 路径）──
await timing('moveProjectToTrash（rename 路径）',
  `window.api.moveProjectToTrash({ folderPath: 'projects/tmp-trash-perf', projectId: 'proj_tmpperf', projectName: 'tmp-trash-perf' })`);
await timing('listTrash（移入后）', `window.api.listTrash()`);

// ── 5. restoreFromTrash ──
const lt = await ev2(`window.api.listTrash()`);
const item = (lt.items || []).find(x => x.projectName === 'tmp-trash-perf');
if (!item) { console.log('✗ 回收站中未找到临时项目'); ws.close(); process.exit(1); }
await timing('restoreFromTrash', `window.api.restoreFromTrash({ trashPath: ${JSON.stringify(item.trashPath)} })`);

// ── 6. moveProjectToTrash（无 folderPath，数据写入路径）──
await timing('moveProjectToTrash（数据写入路径）',
  `window.api.moveProjectToTrash({ folderPath: null, projectId: 'proj_tmpperf2', projectName: 'tmp-trash-perf2', projectData: { projectName: 'tmp-trash-perf2', methodsTree: { id: 'root', name: '根', children: [] }, nodeRichContents: {}, positions2D: {}, positions: {} } })`);

// ── 7. 永久删除两条临时项 + 清理 projects 残留 ──
const lt2 = await ev2(`window.api.listTrash()`);
for (const it of (lt2.items || []).filter(x => String(x.projectName).startsWith('tmp-trash-perf'))) {
  await timing('permanentlyDeleteTrashItem ' + it.folderName, `window.api.permanentlyDeleteTrashItem({ trashPath: ${JSON.stringify(it.trashPath)} })`);
}
await ev2(`window.FSCore.rmrf('projects/tmp-trash-perf')`);
await timing('listTrash（清理后）', `window.api.listTrash()`);

// ── 8. versionGraph 动态 import（删除确认回调里的隐性开销）──
await timing('import(versionGraph)（冷模块）', `import('./modules/versionGraph/versionGraph.js')`);
await timing('import(versionGraph)（热）', `import('./modules/versionGraph/versionGraph.js')`);

console.log('✓ 实测完成（临时数据已清理）');
ws.close();
process.exit(0);
