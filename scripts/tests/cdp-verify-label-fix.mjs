// 巨大标签修复验证：临时项目(1父+2子) → 折叠/展开/展开全部 → 检查 label scale 是否停在基准 0.02 系
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
await ev2('window.__storageReady || Promise.resolve()');
await sleep(800);

// 造临时项目并打开（1 父 + 2 子）
const pid = await ev2(`(async () => {
  const dir = 'projects/tmp-label-fix';
  const c1 = { id: 'TLF1aaaaaaaa', name: '子1', children: [] };
  const c2 = { id: 'TLF2aaaaaaaa', name: '子2', children: [] };
  const pj = { id: 'proj_tlffix', projectName: 'tmp-label-fix', methodsTree: { id: 'root', name: '根', children: [{ id: 'TLF0aaaaaaaa', name: '父', children: [c1, c2] }] }, nodeRichContents: {}, positions2D: {}, positions: {} };
  await window.FSCore.writeText(dir + '/project.json', JSON.stringify(pj));
  const id2 = window.ProjectFsShim.registerExternalProject('tmp-label-fix', dir);
  if (!window.appState.projects.some(p => p.id === id2)) {
    window.appState.projects.unshift({ id: id2, name: 'tmp-label-fix', folderPath: dir, data: null });
  }
  return id2;
})()`);
await ev2(`(async () => { const m2 = await import('./modules/module2_TreeData.js'); m2.loadProject(${JSON.stringify(pid)}); return true; })()`);
let opened = null;
for (let i = 0; i < 20; i++) { await sleep(500); opened = await ev2(`(() => ({ cur: appState.currentProjectId, meshes: appState.nodeMeshes ? appState.nodeMeshes.size : 0 }))()`); if (opened.cur === pid && opened.meshes >= 3) break; }
console.log('打开:', JSON.stringify(opened));
if (!opened || opened.cur !== pid) { console.log('✗ 临时项目未打开'); ws.close(); process.exit(1); }
await sleep(1500);

const scales = `(() => {
  const out = {};
  for (const [nid, obj] of appState.nodeMeshes) {
    if (obj.label) out[nid] = { x: +obj.label.scale.x.toFixed(4), y: +obj.label.scale.y.toFixed(4), base: +(obj.label.userData._labelBaseW || 0).toFixed(4) };
  }
  return out;
})()`;
console.log('初始标签 scale:', JSON.stringify(await ev2(scales)));

// 折叠父节点 → 等 900ms → 展开（toggleChildren）
await ev2(`(async () => { const m5 = await import('./modules/module5_SelectAndEdit.js'); m5.toggleChildren ? m5.toggleChildren('TLF0aaaaaaaa') : console.warn('no toggleChildren'); return true; })()`);
await sleep(900);
console.log('折叠后 scale:', JSON.stringify(await ev2(scales)));
await ev2(`(async () => { const m5 = await import('./modules/module5_SelectAndEdit.js'); m5.toggleChildren('TLF0aaaaaaaa'); return true; })()`);
await sleep(900);
const afterExpand = await ev2(scales);
console.log('展开后 scale:', JSON.stringify(afterExpand));
const bad = Object.entries(afterExpand).filter(([k, v]) => v.base && (Math.abs(v.x - v.base) > 0.005));
console.log(bad.length ? '✗ 有标签未恢复基准: ' + JSON.stringify(bad) : '✓ toggleChildren 展开后标签全部恢复基准 (0.02 系)');

// 展开全部
await ev2(`(async () => { const m5 = await import('./modules/module5_SelectAndEdit.js'); m5.expandAllNodes(); return true; })()`);
await sleep(1200);
const afterAll = await ev2(scales);
const bad2 = Object.entries(afterAll).filter(([k, v]) => v.base && (Math.abs(v.x - v.base) > 0.005));
console.log(bad2.length ? '✗ expandAllNodes 后未恢复: ' + JSON.stringify(bad2) : '✓ expandAllNodes 后标签全部恢复基准');

// 清理临时项目
await ev2(`(async () => {
  const i = appState.projects.findIndex(p => p.id === ${JSON.stringify(pid)});
  if (i !== -1) appState.projects.splice(i, 1);
  await window.FSCore.rmrf('projects/tmp-label-fix');
  return true;
})()`);
console.log('✓ 临时项目已清理');
ws.close();
process.exit(0);
