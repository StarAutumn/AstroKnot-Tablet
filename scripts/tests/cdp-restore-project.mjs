// 恢复现场：列出项目目录 + 当前项目指向，把 currentProjectId 指回真实项目
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
for (let i = 0; i < 20; i++) { if (await ev2('!!window.appState')) break; await new Promise(r => setTimeout(r, 1000)); }
await new Promise(r => setTimeout(r, 1500));

const state = await ev2(`(async () => {
  const dirs = await window.FSCore.listDir('projects').catch(() => []);
  return {
    current: appState.currentProjectId,
    projects: appState.projects.map(p => ({ id: p.id, name: p.name, folder: p.folderPath })),
    dirs: dirs.map(d => d.name),
    nodeCount: appState.nodeMap ? appState.nodeMap.size : 0,
    curName: appState.methodsTree ? (appState.methodsTree.name || '(root)') : null,
    firstChildren: appState.methodsTree && appState.methodsTree.children ? appState.methodsTree.children.slice(0, 3).map(c => c.name) : []
  };
})()`);
console.log(JSON.stringify(state, null, 1));

// 若当前指向 tmp-perf 或不存在目录，切回真实项目（目录数最多的那个）
const fixed = await ev2(`(async () => {
  const cur = appState.currentProjectId;
  const curEntry = appState.projects.find(p => p.id === cur);
  const isTmp = curEntry && /tmp-perf/.test(curEntry.folderPath || '');
  if (!isTmp) return { action: 'none', current: cur };
  // 选一个非 tmp 的项目打开
  const target = appState.projects.find(p => p.folderPath && !/tmp-perf/.test(p.folderPath));
  if (!target) return { action: 'no-target' };
  const m2 = await import('./modules/module2_TreeData.js');
  m2.loadProject(target.id);
  await new Promise(r => setTimeout(r, 2500));
  return { action: 'switched', to: target.id, name: target.name, now: appState.currentProjectId, nodes: appState.nodeMap.size };
})()`);
console.log('恢复结果:', JSON.stringify(fixed));
ws.close();
setTimeout(() => process.exit(0), 300);
