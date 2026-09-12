// CDP 采样 Profile：定位主循环热点函数（2D 静止 / 3D 静止 各 3s）
// 前置：cdp-perf-nodes.mjs 已建临时项目？否——本脚本自建自清理
const NODES = parseInt(process.argv[2] || '99', 10);
const TMP_DIR = 'projects/tmp-perf-' + NODES;
const TMP_NAME = 'tmp-perf-' + NODES;
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
await sleep(1500);

// 造项目 + 打开 + 进 2D（复用 cdp-perf-nodes 逻辑）
const made = await ev2(`(async () => {
  const N = ${NODES};
  const children = []; const positions2D = {};
  for (let i = 0; i < N; i++) {
    const nid = 'N9000' + String(i).padStart(4, '0');
    children.push({ id: nid, name: '节点' + (i + 1), children: [] });
    positions2D[nid] = { x: (i % 10) * 260, y: Math.floor(i / 10) * 200 };
  }
  await window.FSCore.writeText('${TMP_DIR}/project.json', JSON.stringify({ projectName: '${TMP_NAME}', methodsTree: { id: 'root', name: '根', children }, nodeRichContents: {}, positions2D }));
  const id = window.ProjectFsShim.registerExternalProject('${TMP_NAME}', '${TMP_DIR}');
  if (!window.appState.projects.some(p => p.id === id)) window.appState.projects.unshift({ id, name: '${TMP_NAME}', folderPath: '${TMP_DIR}', data: null });
  return id;
})()`);
const origProjectId = await ev2('appState.currentProjectId === ' + JSON.stringify(made) + ' ? appState.currentProjectId : appState.currentProjectId');
await ev2(`(async () => { const m2 = await import('./modules/module2_TreeData.js'); m2.loadProject(${JSON.stringify(made)}); return true; })()`);
for (let i = 0; i < 20; i++) { await sleep(500); if (await ev2('appState.currentProjectId') === made && await ev2('appState.nodeMap.size') >= NODES + 1) break; }
await ev2(`(async () => {
  const sp = document.getElementById('startPage');
  if (sp && getComputedStyle(sp).display !== 'none') { const m = await import('./modules/StartPage/index.js'); if (m.hideStartPage) { m.hideStartPage(); await new Promise(r => setTimeout(r, 800)); } }
  if (!window.appState.is2DView) { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); }
  return true;
})()`);
await sleep(2000);

const agg = (profile, durMs) => {
  const total = profile.nodes.reduce((s, n) => s + (n.hitCount || 0), 0);
  const rows = new Map();
  for (const n of profile.nodes) {
    if (!n.hitCount) continue;
    const k = (n.callFrame.functionName || '(anonymous)') + ' @ ' + (n.callFrame.url || '').split('/').pop() + ':' + n.callFrame.lineNumber;
    rows.set(k, (rows.get(k) || 0) + n.hitCount);
  }
  return { totalHits: total, estMsPerHit: total ? +(durMs / total).toFixed(3) : 0,
    top: [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, h]) => ({ fn: k, hits: h, ms: +(h * (total ? durMs / total : 0)).toFixed(1) })) };
};

await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 200 });

// 2D 静止 3s
await send('Profiler.start');
await sleep(3000);
const p2d = (await send('Profiler.stop')).profile;
console.log('=== 2D 静止 3s 热点 ===');
console.log(JSON.stringify(agg(p2d, 3000), null, 1));

// 3D 静止 3s
await ev2(`(() => { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); return true; })()`);
await sleep(2500);
await send('Profiler.start');
await sleep(3000);
const p3d = (await send('Profiler.stop')).profile;
console.log('=== 3D 静止 3s 热点 ===');
console.log(JSON.stringify(agg(p3d, 3000), null, 1));

// 清理
await ev2(`(async () => {
  const m2 = await import('./modules/module2_TreeData.js');
  if (${JSON.stringify(origProjectId)} !== ${JSON.stringify(made)}) { try { m2.loadProject(${JSON.stringify(origProjectId)}); await new Promise(r => setTimeout(r, 1200)); } catch (e) {} }
  await window.FSCore.rmrf('${TMP_DIR}');
  window.appState.projects = window.appState.projects.filter(p => p.id !== ${JSON.stringify(made)});
  return true;
})()`);
console.log('清理完成');
ws.close();
setTimeout(() => process.exit(0), 300);
