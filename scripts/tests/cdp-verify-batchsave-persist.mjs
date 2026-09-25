// 验证：重启后批量保存提示（hash 持久化后，无内容改动应显示"无变化"）
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState && window.FSCore && window.FSCore.isReady()')) break; await sleep(1000); }

const out = await ev2(`(async () => {
  const o = [];
  let pid = window.appState.currentProjectId;
  if (!pid) {
    const m2 = await import('./modules/module2_TreeData.js');
    const first = (window.appState.projects || [])[0];
    const sp = await import('./modules/StartPage/index.js');
    if (sp.hideStartPage) sp.hideStartPage();
    await m2.loadProject(first.id);
    await new Promise(r => setTimeout(r, 2500));
    o.push('已打开项目: ' + first.name);
  }
  const grabToast = () => {
    const els = document.querySelectorAll('div');
    for (let i = els.length - 1; i >= 0; i--) { const t = els[i].textContent || ''; if (t.indexOf('批量保存完成') === 0) return t; }
    return '(未捕获)';
  };
  const m9 = await import('./modules/module9_FileIO.js');
  await m9.saveAllProjects();
  await new Promise(r => setTimeout(r, 600));
  o.push('本次批量保存 → ' + grabToast());
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
