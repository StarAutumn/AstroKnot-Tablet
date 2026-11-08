// 验证：画布块 overlay 原地复用（音视频/图表不再被 renderAll 重建）
// 运行前提：npx electron . --remote-debugging-port=9333
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page = null;
for (let i = 0; i < 30; i++) {
  try {
    const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json());
    page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
    if (page) break;
  } catch (_) { /* 未就绪 */ }
  await sleep(1000);
}
if (!page) { console.log('CDP 页面未就绪'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const errors = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map(a => a.value || a.description || '').join(' '));
  }
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
await send('Page.enable');
const ev0 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? null : r.result?.value;
};
// 等页面完全就绪再注入（找不到最新导出时先手动重载一次页面）
for (let i = 0; i < 40; i++) { if (await ev0('document.readyState === "complete" && !!window.appState')) break; await sleep(1000); }
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
for (let i = 0; i < 40; i++) {
  const ready = await ev2('!!(window.appState && window.appState.projects && window.appState.projects.length)');
  if (ready) break;
  await sleep(1000);
}
// 确认浏览器侧已拿到最新模块导出
const modCheck = await ev2(`import('./modules/richEditor/core/overlay/overlay-chart.js').then(m => typeof m.updateChartContent).catch(e => 'ERR:' + e.message)`);
console.log('overlay-chart 导出检查: ' + modCheck);

const out = await ev2(`(async () => {
  const o = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const imgs = await import('./modules/richEditor/core/overlay/overlay-images/index.js');
  const blk = await import('./modules/richEditor/core/overlay/overlay-block.js');
  const st = (await import('./modules/richEditor/shared-state.js')).state;

  const projList = window.appState.projects || [];
  if (!projList.length) { o.push('无项目'); return o.join('\\n'); }
  const m2 = await import('./modules/TreeData/index.js');
  let loaded = false;
  for (const p of projList) {
    if (window.appState.currentProjectId !== p.id) {
      m2.loadProject(p.id);
      await sleep(2500);
    }
    if (window.appState.nodeMap.size > 0) { loaded = true; break; }
  }
  if (!loaded) { o.push('项目加载后无节点'); return o.join('\\n'); }
  const target = [...window.appState.nodeMap.values()].find(n => n.activeMode !== 'code');
  if (!target) { o.push('无文本节点'); return o.join('\\n'); }
  const mod = await import('./modules/richEditor/index.js');
  mod.openRichEditor(target.id);
  await sleep(3500);
  const ed = st.tinyEditor;
  o.push('编辑器就绪: ' + !!ed);
  if (!ed) return o.join('\\n');

  const savedContent = ed.getContent(); // 测试结束后还原，避免污染笔记

  const bid = blk.insertOverlayBlock(ed);
  await sleep(400);
  o.push('画布块插入: ' + !!bid);
  if (!bid) return o.join('\\n');

  // 测试环境窗口不可见时 rAF 被浏览器节流（完全不触发），
  // 图表初始化与拖拽反馈都依赖 rAF → 用 setTimeout 垫片保证可验证
  const _rafOrig = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    return setTimeout(function () { cb(performance.now()); }, 0);
  };

  const arr = imgs.overlayImages;
  arr.length = 0;
  arr.push({
    id: 'oly-v1', type: 'video', src: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28y',
    x: 10, y: 10, width: 220, height: 120, zIndex: 1, blockId: bid,
    volume: 1, muted: false, loop: false
  });
  arr.push({
    id: 'oly-a1', type: 'audio', src: 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAA',
    x: 10, y: 150, width: 240, height: 80, zIndex: 2, blockId: bid,
    muted: false, loop: false, fileName: 'probe.mp3'
  });
  arr.push({
    id: 'oly-c1', type: 'chart', chartType: 'bar', chartTitle: '复用验证',
    chartData: { categories: ['A', 'B'], series: [{ name: 'S1', data: [1, 2] }] },
    x: 10, y: 250, width: 300, height: 200, zIndex: 3, blockId: bid
  });
  imgs.renderAll();
  await sleep(500);

  const vItem = document.querySelector('[data-oly-id="oly-v1"]');
  const aItem = document.querySelector('[data-oly-id="oly-a1"]');
  const cItem = document.querySelector('[data-oly-id="oly-c1"]');
  o.push('三类元素已渲染: ' + [!!vItem, !!aItem, !!cItem].join('/'));
  if (!vItem || !aItem || !cItem) return o.join('\\n');

  const vEl = vItem.querySelector('video');
  const aEl = aItem.querySelector('audio');
  const cInst = cItem._olyChart && cItem._olyChart.inst;
  o.push('video/audio/echarts 就绪: ' + [!!vEl, !!aEl, !!cInst].join('/'));
  if (vEl) vEl.playbackRate = 1.5;

  // 连续 renderAll 30 次，测平均耗时并检查节点是否被重建
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) imgs.renderAll();
  const avg = (performance.now() - t0) / 30;
  o.push('renderAll 平均耗时(3 个画布元素): ' + avg.toFixed(2) + 'ms');

  o.push('节点复用 video: ' + (document.querySelector('[data-oly-id="oly-v1"]') === vItem));
  o.push('节点复用 audio: ' + (document.querySelector('[data-oly-id="oly-a1"]') === aItem));
  o.push('节点复用 chart: ' + (document.querySelector('[data-oly-id="oly-c1"]') === cItem));
  o.push('<video> 未重建: ' + (vItem.querySelector('video') === vEl));
  o.push('<audio> 未重建: ' + (aItem.querySelector('audio') === aEl));
  o.push('ECharts 实例未重建: ' + (cItem._olyChart.inst === cInst));
  o.push('DOM 侧播放状态保留(playbackRate=1.5): ' + (vEl.playbackRate === 1.5));

  // 图表数据变化 → 原地 setOption，实例不重建
  const cdata = arr.find(d => d.id === 'oly-c1');
  cdata.chartData.series[0].data = [9, 8];
  imgs.renderAll();
  await sleep(120);
  let optData = null;
  try { optData = cItem._olyChart.inst.getOption().series[0].data; } catch (e) {}
  o.push('图表数据原地更新: ' + (JSON.stringify(optData) === '[9,8]'));
  o.push('更新后实例仍复用: ' + (cItem._olyChart.inst === cInst));

  // 拖拽：直改 DOM，不重建
  const share = await import('./modules/richEditor/core/overlay/overlay-images/share.js');
  const rect = vItem.getBoundingClientRect();
  const beforeLeft = vItem.style.left;
  vItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5, button: 0 }));
  o.push('  拖拽诊断 dragInfo: ' + !!share.getDragInfo());
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 45, clientY: rect.top + 45, button: 0 }));
  o.push('  拖拽诊断 data.x: ' + arr.find(d => d.id === 'oly-v1').x);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 45, clientY: rect.top + 45, button: 0 }));
  await sleep(150);
  const vd = arr.find(d => d.id === 'oly-v1');
  o.push('  拖拽诊断 x/leftPct/_refWidth/blockW: ' + [vd.x, vd.leftPct, vd._refWidth, blk.getBlockWidth(bid)].join(' / '));
  imgs.renderAll();
  o.push('  手动 renderAll 后 left: ' + vItem.style.left);
  o.push('  手动 renderAll 后同一节点: ' + (document.querySelector('[data-oly-id="oly-v1"]') === vItem)
    + ' 节点数: ' + document.querySelectorAll('[data-oly-id="oly-v1"]').length
    + ' dataset.blockId: ' + vItem.dataset.blockId + ' / ' + bid);
  const fresh = document.querySelector('[data-oly-id="oly-v1"]');
  o.push('  当前节点 left: ' + (fresh ? fresh.style.left : 'n/a') + ' 同 video: ' + (fresh && fresh.querySelector('video') === vEl));
  const fresh2 = document.querySelector('[data-oly-id="oly-v1"]');
  o.push('拖拽后 <video> 未重建: ' + (fresh2 && fresh2.querySelector('video') === vEl));
  o.push('拖拽位置已更新: ' + (fresh2 && fresh2.style.left !== beforeLeft) + ' (' + beforeLeft + ' → ' + (fresh2 ? fresh2.style.left : 'n/a') + ')');

  // 清理：还原编辑器内容，移除测试画布块与数据
  arr.length = 0;
  imgs.renderAll();
  ed.setContent(savedContent);
  window.requestAnimationFrame = _rafOrig;
  o.push('已还原编辑器内容');
  return o.join('\\n');
})()`);
console.log(out);
console.log('---console/exception errors---');
console.log(errors.length ? errors.slice(0, 8).join('\n') : '(无)');
ws.close();
process.exit(0);
