// 桌面取证：逐项目调 saveProjectOne 看返回值/folderPath/hash 键
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }

const out = await ev2(`(async () => {
  const o = [];
  const m9 = await import('./modules/module9_FileIO.js');
  for (const p of (window.appState.projects || [])) {
    const keyBefore = 'astroknot_savehash_' + (p.folderPath || p.name || p.id);
    const before = localStorage.getItem(keyBefore);
    const r = await m9.saveProjectOne(p);
    const keyAfter = 'astroknot_savehash_' + (p.folderPath || p.name || p.id);
    o.push('[' + p.name + '] status=' + r.status + ' folderPath: ' + p.folderPath);
    o.push('  键前=' + keyBefore + ' → ' + (before === null ? 'null' : before));
    o.push('  键后=' + keyAfter + ' → ' + (localStorage.getItem(keyAfter) === null ? 'null' : localStorage.getItem(keyAfter)));
    if (r.rootPath) o.push('  rootPath=' + r.rootPath);
    if (r.path) o.push('  result.path=' + r.path);
  }
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
