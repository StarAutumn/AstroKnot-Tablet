// 验证：画布块内元素禁止浏览器原生拖拽（消除整块半透明拖影 + 拖拽卡顿）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const list = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json());
const page = list.find(p => p.type === 'page' && /index\.html/.test(p.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const errors = [];
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable');
const ev2 = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
for (let i = 0; i < 30; i++) { if (await ev2('!!(window.appState && window.appState.projects)')) break; await sleep(1000); }

const out = await ev2(`(async () => {
  const o = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const imgs = await import('./modules/richEditor/core/overlay/overlay-images/index.js');
  const blk = await import('./modules/richEditor/core/overlay/overlay-block.js');
  const st = (await import('./modules/richEditor/shared-state.js')).state;

  // 打开编辑器保证画布块有真实布局（否则 clientWidth=0，百分比坐标无法验证）
  const projList = window.appState.projects || [];
  const m2 = await import('./modules/TreeData/index.js');
  let target = null;
  for (const p of projList) {
    if (window.appState.currentProjectId !== p.id) {
      m2.loadProject(p.id);
      await sleep(2500);
    }
    if (window.appState.nodeMap.size > 0) {
      target = [...window.appState.nodeMap.values()].find(n => n.activeMode !== 'code');
      if (target) break;
    }
  }
  if (!target) { o.push('无文本节点'); return o.join('\\n'); }
  const mod = await import('./modules/richEditor/index.js');
  mod.openRichEditor(target.id);
  await sleep(3500);

  const ed = st.tinyEditor;
  o.push('编辑器就绪: ' + !!ed);
  if (!ed) return o.join('\\n');

  // 可见窗口下 rAF 正常；不可见时用 setTimeout 垫片，保证可验证
  const _rafOrig = window.requestAnimationFrame;
  if (document.visibilityState === 'hidden') {
    window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 0); };
    o.push('（窗口不可见，已用 setTimeout 垫片代替 rAF）');
  }

  const saved = ed.getContent();
  const bid = blk.insertOverlayBlock(ed);
  await sleep(400);

  const arr = imgs.overlayImages;
  arr.length = 0;
  arr.push({ id:'d-v1', type:'video', src:'data:video/mp4;base64,AAAAIGZ0eXBpc29t', x:10, y:10, width:220, height:120, zIndex:1, blockId:bid, volume:1, muted:false, loop:false });
  arr.push({ id:'d-c1', type:'chart', chartType:'bar', chartTitle:'drag', chartData:{categories:['A','B'],series:[{name:'S',data:[1,2]}]}, x:10, y:150, width:300, height:200, zIndex:2, blockId:bid });
  imgs.renderAll();
  await sleep(500);

  const vItem = document.querySelector('[data-oly-id="d-v1"]');
  const cItem = document.querySelector('[data-oly-id="d-c1"]');
  const vEl = vItem && vItem.querySelector('video');
  const blockEl = blk.getBlockElement(bid);
  o.push('元素渲染: ' + [!!vItem, !!cItem, !!vEl].join('/'));
  if (!vItem || !vEl) return o.join('\\n');

  // 1) 属性与计算样式
  o.push('item.draggable === false: ' + (vItem.draggable === false));
  o.push('video.draggable === false: ' + (vEl.draggable === false));
  o.push('item -webkit-user-drag: ' + getComputedStyle(vItem).webkitUserDrag);
  o.push('block -webkit-user-drag: ' + getComputedStyle(blockEl).webkitUserDrag);
  o.push('video -webkit-user-drag: ' + getComputedStyle(vEl).webkitUserDrag);

  // 2) dragstart 拦截：块内 video / item / chart 内部 canvas 都应被 preventDefault
  function fireDragStart(target) {
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    const notCancelled = target.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented, notCancelled };
  }
  const dsVideo = fireDragStart(vEl);
  const dsItem = fireDragStart(vItem);
  const chartCanvas = cItem ? cItem.querySelector('canvas') : null;
  const dsCanvas = chartCanvas ? fireDragStart(chartCanvas) : { prevented: null, notCancelled: null };
  o.push('dragstart(video) 被阻止: ' + (dsVideo.prevented && dsVideo.notCancelled === false));
  o.push('dragstart(item) 被阻止: ' + (dsItem.prevented && dsItem.notCancelled === false));
  o.push('dragstart(chart canvas) 被阻止: ' + (dsCanvas.prevented && dsCanvas.notCancelled === false));

  // 3) 块外元素不受影响（避免误伤正文/其他模块的拖拽）
  const p = document.createElement('p');
  p.textContent = '正文';
  ed.getBody().appendChild(p);
  const dsP = fireDragStart(p);
  o.push('块外 dragstart 未被误拦: ' + (dsP.prevented === false));
  p.remove();

  // 4) 60 次连续 mousemove 的拖拽耗时与最终位置
  const rect = vItem.getBoundingClientRect();
  vItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5, button: 0 }));
  const t0 = performance.now();
  for (let i = 1; i <= 60; i++) {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 5 + i * 2, clientY: rect.top + 5 + i, button: 0 }));
  }
  const avg = (performance.now() - t0) / 60;
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 125, clientY: rect.top + 65, button: 0 }));
  await sleep(120);
  const vd = arr.find(d => d.id === 'd-v1');
  o.push('60 次 mousemove 平均: ' + avg.toFixed(3) + 'ms/次');
  o.push('拖拽后位置: x=' + vd.x + ' left=' + vItem.style.left + ' leftPct=' + (vd.leftPct || 0).toFixed(2));
  o.push('拖拽后 video 未重建: ' + (vItem.querySelector('video') === vEl));

  // 5) 缓存生效：拖拽期间未再查询过块宽度（对比 blockW 与实时宽度）
  o.push('缓存的块宽与实际块宽一致: ' + (Math.abs((vd._refWidth || 0) - blk.getBlockWidth(bid)) < 0.5));

  arr.length = 0;
  imgs.renderAll();
  ed.setContent(saved);
  window.requestAnimationFrame = _rafOrig;
  o.push('已还原编辑器内容');
  return o.join('\\n');
})()`);
console.log(out);
console.log('---errors---');
console.log(errors.length ? errors.slice(0, 6).join('\n') : '(无)');
ws.close();
process.exit(0);
