// 桌面数据格式一致性验证：project.json 字段 / project.md / nodes / .versiongraph / localStorage 迁移
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
await sleep(800);

// ── 0. 桌面基准字段 ──
const DESKTOP_KEYS = ['projectName', 'methodsTree', 'crossEdges', 'positions', 'positions2D', 'collapsed2D',
  'layers', 'currentLayerId', 'nodeHtmlSources', 'nodeSandboxHistories', 'treeEdgeLabels', 'cameraView'];

// ── 1. 预塞旧 localStorage 键（测迁移）──
await ev2(`localStorage.setItem('astroknot_vgraph:legacy-proj-x', JSON.stringify({ commits: [{ id: 'c1', time: 1700000000000 }], branches: [{ name: '主线' }], HEAD: 'c1' }));
localStorage.setItem('astroknot_vblob:legacy-proj-x:abc123', JSON.stringify({ nodes: [], edges: [] }));`);
console.log('已预塞旧 localStorage 键（迁移测试）');

// ── 2. 造临时项目并打开 ──
const pid = await ev2(`(async () => {
  const dir = 'projects/tmp-parity';
  const child = { id: 'TPR1aaaaaaaa', name: '子节点', children: [] };
  const pj = { id: 'proj_parity', projectName: 'tmp-parity',
    methodsTree: { id: '__VIRTUAL_ROOT__', name: '根', children: [{ id: 'TPR0aaaaaaaa', name: '父节点', isStepFlow: true, children: [child] }] },
    crossEdges: [{ sourceId: 'TPR0aaaaaaaa', targetId: 'TPR1aaaaaaaa', customColor: '#ff0000', label: '测试线' }],
    nodeRichContents: { TPR0aaaaaaaa: '<p>父内容</p>' },
    positions2D: {}, positions: {} };
  await window.FSCore.writeText(dir + '/project.json', JSON.stringify(pj));
  const id2 = window.ProjectFsShim.registerExternalProject('tmp-parity', dir);
  if (!window.appState.projects.some(p => p.id === id2)) {
    window.appState.projects.unshift({ id: id2, name: 'tmp-parity', folderPath: dir, data: null });
  }
  return id2;
})()`);
await ev2(`(async () => { const m2 = await import('./modules/module2_TreeData.js'); m2.loadProject(${JSON.stringify(pid)}); return true; })()`);
await sleep(2000);

// 编辑触发写盘 + 等防抖落盘
await ev2(`(async () => {
  const m2 = await import('./modules/module2_TreeData.js');
  appState.nodeRichContents = appState.nodeRichContents || {};
  m2.saveCurrentProjectData();
  return true;
})()`);
await sleep(1800);

// ── 3. 校验 project.json 字段 ──
const pjKeys = await ev2(`(async () => {
  const raw = await window.FSCore.readText('projects/tmp-parity/project.json');
  return Object.keys(JSON.parse(raw)).sort();
})()`);
const expect = DESKTOP_KEYS.slice().sort();
const keysOk = JSON.stringify(pjKeys) === JSON.stringify(expect);
console.log(keysOk ? '✓ project.json 字段与桌面完全一致（12 字段）' : '✗ project.json 字段不一致:\n  实际: ' + pjKeys.join(',') + '\n  期望: ' + expect.join(','));

// ── 4. 校验 project.md ──
const md = await ev2(`(async () => {
  try { return await window.FSCore.readText('projects/tmp-parity/project.md'); } catch (e) { return ''; }
})()`);
const mdOk = md.includes('# 🌳 tmp-parity') && md.includes('TPR0aaaaaaaa') && md.includes('跨层连线');
console.log(mdOk ? '✓ project.md 已生成（桌面同款摘要）' : '✗ project.md 缺失或内容不对: ' + md.slice(0, 120));

// ── 5. 校验 nodes/<id>/content.html ──
const content = await ev2(`(async () => {
  try { return await window.FSCore.readText('projects/tmp-parity/nodes/TPR0aaaaaaaa/content.html'); } catch (e) { return ''; }
})()`);
console.log(content.includes('父内容') ? '✓ nodes/<nodeId>/content.html 落盘正确' : '✗ content.html 不对: ' + content.slice(0, 80));

// ── 6. 版本图文件层 ──
const vg = await ev2(`(async () => {
  await window.api.versionSaveGraph('projects/tmp-parity', { commits: [{ id: 'c1', time: 1700000000000 }], branches: [{ name: '主线' }], HEAD: 'c1' });
  await window.api.versionSaveBlob('projects/tmp-parity', 'abc123', { nodes: [], edges: [] });
  const g = await window.FSCore.readText('projects/tmp-parity/.versiongraph/graph.json');
  const b = await window.FSCore.readText('projects/tmp-parity/.versiongraph/blobs/abc123.json');
  const lg = await window.api.versionLoadGraph('projects/tmp-parity');
  const lb = await window.api.versionLoadBlob('projects/tmp-parity', 'abc123');
  return {
    graphIndented: g.includes('\\n  "commits"'),
    blobFlat: b === '{"nodes":[],"edges":[]}',
    loadOk: lg.graph && lg.graph.HEAD === 'c1',
    blobOk: lb.content && Array.isArray(lb.content.nodes),
  };
})()`);
console.log(vg.graphIndented ? '✓ graph.json（2 空格缩进，桌面同款）' : '✗ graph.json 格式不对');
console.log(vg.blobFlat ? '✓ blobs/<hash>.json（无缩进，桌面同款）' : '✗ blob 格式不对');
console.log(vg.loadOk && vg.blobOk ? '✓ 版本图读回正常' : '✗ 版本图读回失败');

// ── 7. 旧 localStorage 迁移（迁移逻辑在启动时已跑；验证文件+键清理）──
const mig = await ev2(`(async () => {
  let g = '', b = '';
  try { g = await window.FSCore.readText('system/version-graphs-tmp/legacy-proj-x/.versiongraph/graph.json'); } catch (e) {}
  try { b = await window.FSCore.readText('system/version-graphs-tmp/legacy-proj-x/.versiongraph/blobs/abc123.json'); } catch (e) {}
  return { g, b, keyGone: !localStorage.getItem('astroknot_vgraph:legacy-proj-x'), blobGone: !localStorage.getItem('astroknot_vblob:legacy-proj-x:abc123') };
})()`);
console.log(mig.g && mig.keyGone && mig.b && mig.blobGone ? '✓ 旧 localStorage 版本数据已迁移到桌面同构文件层' : '✗ 迁移未完成: ' + JSON.stringify(mig).slice(0, 200));

// ── 8. 清理 ──
await ev2(`(async () => {
  await window.api.versionDeleteGraph('projects/tmp-parity');
  const i = appState.projects.findIndex(p => p.id === ${JSON.stringify(pid)});
  if (i !== -1) appState.projects.splice(i, 1);
  await window.FSCore.rmrf('projects/tmp-parity');
  await window.FSCore.rmrf('system/version-graphs-tmp/legacy-proj-x');
  return true;
})()`);
console.log('✓ 测试数据已清理');
ws.close();
process.exit(0);
