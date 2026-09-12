// 修复 currentProjectId 指向已删临时项目的问题：改存储指针 → 重启前准备
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

const targetId = 'proj_1789216953955_7v30kc'; // 开发历程（测试前打开的项目）
const r = await ev2(`(function () {
  // 1) 内存态立即脱离临时项目，指向真实项目（防 flushSave 写盘到已删文件夹）
  window.appState.currentProjectId = ${JSON.stringify(targetId)};
  // 2) 持久指针同步修正（SystemStorageFs 的 set/get 语义与 app 内部一致）
  try { window.SystemStorageFs.set('astroknot_web_projects_current', ${JSON.stringify(targetId)}); } catch (e) {}
  var raw = null;
  try { raw = window.SystemStorageFs.get('astroknot_web_projects_current'); } catch (e) { raw = 'GET_ERR'; }
  return { memNow: appState.currentProjectId, storedNow: raw, projectsLen: appState.projects.length };
})()`);
console.log('修正结果:', JSON.stringify(r));
ws.close();
setTimeout(() => process.exit(r.memNow === targetId ? 0 : 1), 300);
