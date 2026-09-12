// 真机性能诊断：临时大项目（默认 99 子节点）+ 分场景帧耗时/FPS 采集
// 用法：node scripts/tests/cdp-perf-nodes.mjs [节点数]
// 产出：各场景 { 工作帧率, JS 帧耗时 avg/p95, draw/composer/label 分解 }，测试完清理
const NODES = parseInt(process.argv[2] || '99', 10);
const TMP_DIR = 'projects/tmp-perf-' + NODES;
const TMP_NAME = 'tmp-perf-' + NODES;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const list = await fetch('http://127.0.0.1:9222/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && p.url.startsWith('https://localhost'));
if (!page) { console.log('✗ 未找到平板页面'); process.exit(1); }
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
await sleep(2000);

// ── 统计工具 ──
const stat = (arr) => {
  if (!arr.length) return { n: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const avg = s.reduce((x, y) => x + y, 0) / s.length;
  return { n: s.length, avg: +avg.toFixed(2), p50: +s[Math.floor(s.length * 0.5)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

// ── 1. 造临时项目 ──
const origProjectId = await ev2('appState.currentProjectId');
const made = await ev2(`(async () => {
  const N = ${NODES};
  const children = [];
  const positions2D = {};
  for (let i = 0; i < N; i++) {
    const nid = 'N9000' + String(i).padStart(4, '0');
    children.push({ id: nid, name: '节点' + (i + 1), children: [] });
    positions2D[nid] = { x: (i % 10) * 260, y: Math.floor(i / 10) * 200 };
  }
  const pj = {
    projectName: '${TMP_NAME}',
    methodsTree: { id: 'root', name: '根', children },
    nodeRichContents: {},
    positions2D,
  };
  await window.FSCore.writeText('${TMP_DIR}/project.json', JSON.stringify(pj));
  const id = window.ProjectFsShim.registerExternalProject('${TMP_NAME}', '${TMP_DIR}');
  if (!window.appState.projects.some(p => p.id === id)) {
    window.appState.projects.unshift({ id, name: '${TMP_NAME}', folderPath: '${TMP_DIR}', data: null });
  }
  return id;
})()`);
console.log('临时项目 id =', made);

// ── 2. 打开临时项目 ──
await ev2(`(async () => {
  const m2 = await import('./modules/module2_TreeData.js');
  m2.loadProject(${JSON.stringify(made)});
  return true;
})()`);
let opened = null;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  opened = await ev2(`(() => ({ cur: appState.currentProjectId, nodes: appState.nodeMap ? appState.nodeMap.size : 0, meshes: appState.nodeMeshes ? appState.nodeMeshes.size : 0, lines: appState.lineItems ? appState.lineItems.length : 0 }))()`);
  if (opened.cur === made && opened.nodes >= NODES + 1) break;
}
console.log('打开结果:', JSON.stringify(opened));
if (!opened || opened.cur !== made) { console.log('✗ 临时项目未打开，终止（不清理，可手动检查）'); ws.close(); process.exit(1); }

// ── 3. 进 2D 模式 ──
await ev2(`(async () => {
  const sp = document.getElementById('startPage');
  if (sp && getComputedStyle(sp).display !== 'none') {
    const m = await import('./modules/StartPage/index.js');
    if (m.hideStartPage) { m.hideStartPage(); await new Promise(r => setTimeout(r, 800)); }
  }
  if (!window.appState.is2DView) { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); }
  return true;
})()`);
await sleep(2500);

// ── 4. 装探针 ──
await ev2(`(() => {
  window.__perf = { frames: [], draw: [], composer: [], label: [] };
  const P = window.__perf;
  const orig2d = appState.redraw2DView;
  appState.redraw2DView = function () { const t0 = performance.now(); orig2d(); P.draw.push(performance.now() - t0); };
  const oc = appState.effectComposer.render.bind(appState.effectComposer);
  appState.effectComposer.render = function (...a) { const t0 = performance.now(); const r = oc(...a); P.composer.push(performance.now() - t0); return r; };
  const ol = appState.labelRenderer.render.bind(appState.labelRenderer);
  appState.labelRenderer.render = function (...a) { const t0 = performance.now(); const r = ol(...a); P.label.push(performance.now() - t0); return r; };
  const oRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) { return oRAF(function (ts) { const t0 = performance.now(); cb(ts); P.frames.push(performance.now() - t0); }); };
  return true;
})()`);

const clearProbe = `(() => { window.__perf.frames.length = 0; window.__perf.draw.length = 0; window.__perf.composer.length = 0; window.__perf.label.length = 0; return true; })()`;
const info = `(() => ({
  canvas: { w: document.getElementById('view2dCanvas').width, h: document.getElementById('view2dCanvas').height },
  dpr: window.devicePixelRatio, pixelRatio: appState.renderer ? appState.renderer.getPixelRatio() : null,
  simple3D: appState.simple3D, nodes: appState.nodeMap.size, lines: appState.lineItems.length,
  visibleNodes: (window.__visCount = 0, window.__visCount)
}))()`;

const report = {};
console.log('环境:', JSON.stringify(await ev2(info)));

// ── 场景 A：2D 静止 4s ──
await ev2(clearProbe);
await sleep(4000);
report['A_2D静止'] = await ev2(`(() => {
  const P = window.__perf;
  return { fps2D: +(P.draw.length / 4).toFixed(1), draw: P.draw.slice(), frames: P.frames.slice() };
})()`);
console.log('A_2D静止: fps=' + report['A_2D静止'].fps2D, 'draw=' + JSON.stringify(stat(report['A_2D静止'].draw)), 'frame=' + JSON.stringify(stat(report['A_2D静止'].frames)));

// ── 场景 B：2D 拖动平移 3s（直接改 transform，主循环照常重绘）──
await ev2(clearProbe);
await ev2(`(async () => {
  const s = await import('./modules/2DView/shared.js');
  const t0 = performance.now();
  let i = 0;
  while (performance.now() - t0 < 3000) {
    s.transform.offsetX += 3; s.transform.offsetY += 2;
    i++;
    await new Promise(r => setTimeout(r, 16));
  }
  return i;
})()`);
report['B_2D平移'] = await ev2(`(() => { const P = window.__perf; return { fps2D: +(P.draw.length / 3).toFixed(1), draw: P.draw.slice(), frames: P.frames.slice() }; })()`);
console.log('B_2D平移: fps=' + report['B_2D平移'].fps2D, 'draw=' + JSON.stringify(stat(report['B_2D平移'].draw)), 'frame=' + JSON.stringify(stat(report['B_2D平移'].frames)));

// ── 场景 C：2D 纯 draw 突发 30 次（隔离单次绘制成本）──
report['C_2D单帧draw'] = await ev2(`(async () => {
  const arr = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    appState.redraw2DView();
    arr.push(performance.now() - t0);
    await new Promise(r => setTimeout(r, 30));
  }
  return arr;
})()`);
console.log('C_2D单帧draw:', JSON.stringify(stat(report['C_2D单帧draw'])));

// ── 场景 D：3D 静止 4s ──
await ev2(`(() => { const b = document.getElementById('modeToggleBtn'); if (b) b.click(); return true; })()`);
await sleep(3000);
await ev2(clearProbe);
await sleep(4000);
report['D_3D静止'] = await ev2(`(() => {
  const P = window.__perf;
  return { fps3D: +(P.composer.length / 4).toFixed(1), composer: P.composer.slice(), label: P.label.slice(), frames: P.frames.slice(),
    drawCalls: appState.renderer.info.render.calls, tris: appState.renderer.info.render.triangles };
})()`);
console.log('D_3D静止: fps=' + report['D_3D静止'].fps3D, 'composer=' + JSON.stringify(stat(report['D_3D静止'].composer)), 'label=' + JSON.stringify(stat(report['D_3D静止'].label)), 'frame=' + JSON.stringify(stat(report['D_3D静止'].frames)), 'drawCalls=' + report['D_3D静止'].drawCalls, 'tris=' + report['D_3D静止'].tris);

// ── 清理：回到原项目 + 删临时目录 + 摘除内存清单 ──
// 注意：origProjectId 可能在多次运行后指向已删的临时项目（=== made），此时必须
// 兜底切到磁盘上第一个真实项目，否则 loadProject(已删目录) 失败会清空 appState.projects
const cleaned = await ev2(`(async () => {
  const made = ${JSON.stringify(made)};
  const orig = ${JSON.stringify(origProjectId)};
  let target = (orig && orig !== made && appState.projects.some(p => p.id === orig)) ? orig : null;
  if (!target) {
    const list = (window.ProjectFsShim.getProjects ? window.ProjectFsShim.getProjects() : []) || [];
    const real = list.find(p => p.folderPath && !/tmp-perf/.test(p.folderPath));
    target = real ? real.id : null;
  }
  if (target) {
    const m2 = await import('./modules/module2_TreeData.js');
    try { m2.loadProject(target); } catch (e) {}
    await new Promise(r => setTimeout(r, 2000));
  }
  // 先脱离临时项目再删目录，避免 flushSave 把临时数据写回磁盘
  if (appState.currentProjectId === made) appState.currentProjectId = target || '';
  await window.FSCore.rmrf('${TMP_DIR}');
  window.appState.projects = window.appState.projects.filter(p => p.id !== made);
  return appState.currentProjectId;
})()`);
console.log('清理完成，回到项目:', cleaned);

// 汇总
const summary = {
  A_2D静止: { fps: report['A_2D静止'].fps2D, draw: stat(report['A_2D静止'].draw), frame: stat(report['A_2D静止'].frames) },
  B_2D平移: { fps: report['B_2D平移'].fps2D, draw: stat(report['B_2D平移'].draw), frame: stat(report['B_2D平移'].frames) },
  C_2D单帧draw: stat(report['C_2D单帧draw']),
  D_3D静止: { fps: report['D_3D静止'].fps3D, composer: stat(report['D_3D静止'].composer), label: stat(report['D_3D静止'].label), frame: stat(report['D_3D静止'].frames), drawCalls: report['D_3D静止'].drawCalls, tris: report['D_3D静止'].tris },
};
console.log('\n=== 汇总 ===');
console.log(JSON.stringify(summary, null, 1));
ws.close();
setTimeout(() => process.exit(0), 300);
