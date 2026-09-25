// 桌面诊断：磁盘加载形态 vs 实时同步形态 的逐字段 hash 对比（定位往返不对称字段）
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
  const qh = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
  const snap = () => window.appState.projects.filter(p => p.data && p.data.methodsTree).map(p => {
    const d = p.data;
    const po = {}; if (d.positions instanceof Map) for (const [id, v] of d.positions.entries()) po[id] = { x: v.x, y: v.y, z: v.z };
    const p2 = {}; if (d.positions2D) { const en = d.positions2D instanceof Map ? d.positions2D.entries() : Object.entries(d.positions2D); for (const [id, v] of en) p2[id] = { x: v.x, y: v.y }; }
    return { id: p.id, name: p.name, fields: {
      methodsTree: qh(JSON.stringify(d.methodsTree)), crossEdges: qh(JSON.stringify(d.crossEdges || [])),
      positions: qh(JSON.stringify(po)), positions2D: qh(JSON.stringify(p2)),
      collapsed2D: qh(JSON.stringify(d.collapsed2D || [])), layers: qh(JSON.stringify(d.layers || [])),
      currentLayerId: qh(String(d.currentLayerId)), nodeRichContents: qh(JSON.stringify(d.nodeRichContents || {})),
      nodeFileSystems: qh(JSON.stringify(d.nodeFileSystems || {})), nodeSandboxHistories: qh(JSON.stringify(d.nodeSandboxHistories || {})),
      treeEdgeLabels: qh(JSON.stringify(d.treeEdgeLabels || {})), cameraView: qh(JSON.stringify(d.cameraView || null))
    }, raw: d };
  });
  const o = [];
  let pid = window.appState.currentProjectId;
  if (!pid) {
    const m2 = await import('./modules/module2_TreeData.js');
    const first = (window.appState.projects || [])[0];
    const sp = await import('./modules/StartPage/index.js');
    if (sp.hideStartPage) sp.hideStartPage();
    await m2.loadProject(first.id);
    await new Promise(r => setTimeout(r, 2500));
    pid = window.appState.currentProjectId;
    o.push('已打开项目: ' + first.name);
  }
  const t0 = snap();
  o.push('t0(磁盘加载形态): ' + t0.map(p => p.name + ' tree=' + p.fields.methodsTree + ' rich=' + p.fields.nodeRichContents + ' pos2d=' + p.fields.positions2D + ' hist=' + p.fields.nodeSandboxHistories + ' cam=' + p.fields.cameraView).join(' | '));
  // 实时同步（批量保存开头做的就是这件事）
  const m2 = await import('./modules/module2_TreeData.js');
  await m2.saveCurrentProjectData();
  const t1 = snap();
  o.push('t1(实时同步形态): ' + t1.map(p => p.name + ' tree=' + p.fields.methodsTree + ' rich=' + p.fields.nodeRichContents + ' pos2d=' + p.fields.positions2D + ' hist=' + p.fields.nodeSandboxHistories + ' cam=' + p.fields.cameraView).join(' | '));
  for (let i = 0; i < t1.length; i++) {
    const a = t0[i], b = t1[i];
    if (!a) continue;
    const changed = Object.keys(b.fields).filter(k => b.fields[k] !== a.fields[k]);
    o.push('项目[' + b.name + '] ' + (changed.length ? '往返漂移字段: ' + changed.join(', ') : '往返对称'));
    for (const k of changed.slice(0, 3)) {
      const grab = (tag) => { const p = (tag ? t0 : t1)[i]; return JSON.stringify(p.raw[k === 'cameraView' ? 'cameraView' : k] ?? p.raw[k]).slice(0, 300); };
      o.push('  ' + k + ' 前: ' + grab(1));
      o.push('  ' + k + ' 后: ' + grab(0));
    }
  }
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
