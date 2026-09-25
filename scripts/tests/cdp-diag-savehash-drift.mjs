// 诊断：批量保存 hash 漂移——间隔采样复刻序列化，逐字段定位"什么都没做却变化"的字段
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
      treeEdgeLabels: qh(JSON.stringify(d.treeEdgeLabels || {})),
      cameraView: qh(JSON.stringify(d.cameraView || null)), savePath: qh(String(window.appState.currentProjectSavePath))
    }, raw: d };
  });
  const t0 = snap();
  const o = ['轮0: ' + t0.map(p => p.name + ' cam=' + p.fields.cameraView).join(' | ')];
  for (let r = 1; r <= 4; r++) {
    await new Promise(rs => setTimeout(rs, 2000));
    const t = snap();
    const parts = [];
    for (let i = 0; i < t.length; i++) {
      const a = i < t0.length ? t0[i] : null;
      if (!a) { parts.push(t[i].name + '(新)'); continue; }
      const changed = Object.keys(t[i].fields).filter(k => t[i].fields[k] !== a.fields[k]);
      parts.push(t[i].name + (changed.length ? ' ←漂移:' + changed.join(',') : ' 稳定'));
    }
    o.push('轮' + r + ': ' + parts.join(' | '));
  }
  // cameraView 具体值对比（第一位项目的相机数值演化）
  o.push('cameraView 原始值: ' + JSON.stringify(window.appState.projects[0].data.cameraView));
  return o.join('\\n');
})()`);
console.log(out);
ws.close();
process.exit(0);
