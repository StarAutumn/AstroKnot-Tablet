// 深度诊断：hook console + 确保 initVersionAutoSave + 派发事件观察具体反应
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
  // 1. hook console 捕获版本图相关输出
  window.__vgLogs = [];
  ['log','warn','error'].forEach(k => {
    const orig = console[k].bind(console);
    console[k] = function () {
      const s = Array.from(arguments).map(a => (a instanceof Error ? a.message : String(a))).join(' ');
      if (s.indexOf('版本图') >= 0 || s.indexOf('tablet-version') >= 0) window.__vgLogs.push(k + ': ' + s);
      orig.apply(console, arguments);
    };
  });
  // 2. 确保 initVersionAutoSave 已调用（幂等）
  try {
    const vas = await import('./modules/versionGraph/versionAutoSave.js');
    vas.initVersionAutoSave();
    o.push('initVersionAutoSave 调用成功');
  } catch (e) { o.push('initVersionAutoSave 异常: ' + e.message); }
  // 3. 快照检查
  const m2 = await import('./modules/module2_TreeData.js');
  let snap = null;
  try { snap = m2.getEmergencySnapshot(); } catch (e) { snap = null; o.push('快照异常: ' + e.message); }
  o.push('快照 = ' + (snap ? 'OK(tree类型=' + typeof (snap.snapshot && snap.snapshot.methodsTree) + ')' : 'null'));
  // 4. 派发保存事件
  window.dispatchEvent(new CustomEvent('astroknot-project-saved'));
  await new Promise(r => setTimeout(r, 5000));
  o.push('捕获日志: ' + (window.__vgLogs.length ? window.__vgLogs.join(' | ') : '（无版本图相关输出）'));
  // 5. commits 状态
  const vg = await import('./modules/versionGraph/versionGraph.js');
  const pid = window.appState.currentProjectId;
  const g = await vg.getGraph(pid);
  o.push('commits = ' + ((g.commits || []).length) + ', HEAD = ' + JSON.stringify(g.HEAD ? (g.HEAD.id || g.HEAD) : null));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
