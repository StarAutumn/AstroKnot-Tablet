// 捕获开发历程保存失败的具体错误
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState')) break; await sleep(i => {}, 0); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const out = await ev2(`(async () => {
  const o = [];
  const errs = [];
  const origErr = console.error.bind(console);
  console.error = function () { errs.push(Array.from(arguments).map(a => (a instanceof Error ? (a.stack || a.message) : String(a))).join(' ')); origErr.apply(console, arguments); };
  const m9 = await import('./modules/module9_FileIO.js');
  const p = (window.appState.projects || []).find(x => x.name === '开发历程');
  if (!p) return '未找到开发历程项目';
  o.push('data 字段: ' + Object.keys(p.data || {}).join(', '));
  o.push('methodsTree 存在: ' + !!(p.data && p.data.methodsTree));
  o.push('folderPath: ' + p.folderPath);
  o.push('currentProjectSavePath: ' + window.appState.currentProjectSavePath);
  const r = await m9.saveProjectOne(p);
  o.push('status=' + r.status);
  console.error = origErr;
  o.push('console.error 捕获: ' + (errs.length ? errs.join(' || ').slice(0, 600) : '（无）'));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
