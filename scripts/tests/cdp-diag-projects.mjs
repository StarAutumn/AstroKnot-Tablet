// 诊断：项目列表为何为空 + 从磁盘扫描恢复
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
await sleep(2000);

const expr = `
(async () => {
  const dirs = await window.FSCore.listDir('projects').catch(function (e) { return 'ERR:' + e.message; });
  let projects = window.ProjectFsShim.getProjects ? window.ProjectFsShim.getProjects() : null;
  if (Array.isArray(projects)) projects = projects.map(function (p) { return { id: p.id, name: p.name, folder: p.folderPath }; });
  var sp = document.getElementById('startPage');
  return {
    dirs: Array.isArray(dirs) ? dirs.map(function (d) { return d.name; }) : dirs,
    shimProjects: projects,
    appProjects: appState.projects.map(function (p) { return { id: p.id, name: p.name }; }),
    current: appState.currentProjectId,
    nodeMap: appState.nodeMap ? appState.nodeMap.size : null,
    treeName: appState.methodsTree ? appState.methodsTree.name : null,
    startPageVisible: sp ? getComputedStyle(sp).display !== 'none' : null
  };
})()
`;
console.log(JSON.stringify(await ev2(expr), null, 1));
ws.close();
setTimeout(() => process.exit(0), 300);
