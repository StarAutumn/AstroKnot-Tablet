// 把 currentProjectId 切回「开发历程」（测试前打开的项目）
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

const r = await ev2(`(async () => {
  const target = appState.projects.find(p => p.folderPath === 'projects/开发历程');
  if (!target) return { ok: false, err: '未找到项目', list: appState.projects.map(p => p.folderPath) };
  const m2 = await import('./modules/module2_TreeData.js');
  m2.loadProject(target.id);
  await new Promise(r => setTimeout(r, 3000));
  return { ok: appState.currentProjectId === target.id, now: appState.currentProjectId, name: target.name,
    nodes: appState.nodeMap ? appState.nodeMap.size : 0,
    firstChildren: appState.methodsTree && appState.methodsTree.children ? appState.methodsTree.children.slice(0, 3).map(c => c.name) : [] };
})()`);
console.log(JSON.stringify(r, null, 1));
ws.close();
setTimeout(() => process.exit(r.ok ? 0 : 1), 300);
