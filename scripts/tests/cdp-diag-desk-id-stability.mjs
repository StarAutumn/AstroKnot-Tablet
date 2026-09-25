// 验证：项目 id 稳定性——localStorage hash 键集合 vs 当前项目 id
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
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
const out = await ev2(`(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf('astroknot_savehash_') === 0) keys.push(k + '=' + localStorage.getItem(k)); }
  const projs = (window.appState.projects || []).map(p => p.id + ' (' + p.name + ') folderPath=' + (p.folderPath || '无'));
  return 'savehash 键:\\n  ' + keys.join('\\n  ') + '\\n项目 id:\\n  ' + projs.join('\\n  ') + '\\ncurrentProjectId=' + window.appState.currentProjectId;
})()`);
console.log(out);
ws.close();
process.exit(0);
