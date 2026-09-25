// 动态诊断：版本自动提交链路（事件 → commit → 存储）逐环验证
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

const out = await ev2(`(async () => {
  const o = [];
  const pid = window.appState.currentProjectId;
  o.push('currentProjectId = ' + JSON.stringify(pid));
  // 1. 快照可用性
  const m2 = await import('./modules/module2_TreeData.js');
  let snap = null;
  try { snap = m2.getEmergencySnapshot ? m2.getEmergencySnapshot() : 'NO_FN'; } catch (e) { snap = 'THROW: ' + e.message; }
  o.push('getEmergencySnapshot() = ' + (snap === 'NO_FN' ? '函数不存在' : snap ? 'OK(节点数=' + ((snap.snapshot && snap.snapshot.methodsTree || []).length) + ')' : 'null'));
  // 2. 读当前 commits 基线
  const vg = await import('./modules/versionGraph/versionGraph.js');
  const key = vg.getVersionKey(pid);
  o.push('getVersionKey = ' + JSON.stringify(key));
  const g0 = await vg.getGraph(pid);
  const n0 = (g0.commits || []).length;
  o.push('基线 commits = ' + n0);
  // 3. 派发保存事件（模拟用户保存），观察自动提交
  window.dispatchEvent(new CustomEvent('astroknot-project-saved'));
  await new Promise(r => setTimeout(r, 3000));
  const g1 = await vg.getGraph(pid);
  const n1 = (g1.commits || []).length;
  o.push('派发保存事件后 commits = ' + n1 + (n1 > n0 ? ' → 自动提交链路正常' : ' → 事件链路未产生提交'));
  // 4. 若事件链路没效果，直接手动 commit 测试存储链路
  if (n1 === n0 && snap && snap !== 'NO_FN') {
    try {
      const r = await vg.commit(pid, snap.snapshot, '诊断手动提交');
      const g2 = await vg.getGraph(pid);
      o.push('手动 commit → ' + JSON.stringify(r).slice(0, 120) + '，现 commits = ' + (g2.commits || []).length);
    } catch (e) { o.push('手动 commit 异常: ' + e.message); }
  }
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
