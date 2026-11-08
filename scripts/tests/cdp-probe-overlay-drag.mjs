// 调试探针：画布块 overlay 拖拽 + ECharts 可用性
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
  if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

console.log(await ev2(`(async () => {
  const o = [];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const imgs = await import('./modules/richEditor/core/overlay/overlay-images/index.js');
  const blk = await import('./modules/richEditor/core/overlay/overlay-block.js');
  const share = await import('./modules/richEditor/core/overlay/overlay-images/share.js');
  const st = (await import('./modules/richEditor/shared-state.js')).state;

  o.push('window.echarts: ' + (typeof window.echarts));
  const ed = st.tinyEditor;
  o.push('editor: ' + !!ed);
  if (!ed) return o.join('\\n');

  const bid = blk.insertOverlayBlock(ed);
  await sleep(400);
  const arr = imgs.overlayImages;
  arr.length = 0;
  arr.push({ id:'p-v1', type:'video', src:'data:video/mp4;base64,AAAAIGZ0eXBpc29t', x:10, y:10, width:220, height:120, zIndex:1, blockId:bid, volume:1, muted:false, loop:false });
  arr.push({ id:'p-c1', type:'chart', chartType:'bar', chartTitle:'probe', chartData:{categories:['A','B'],series:[{name:'S',data:[1,2]}]}, x:10, y:150, width:300, height:200, zIndex:2, blockId:bid });
  imgs.renderAll();
  await sleep(600);

  const vItem = document.querySelector('[data-oly-id="p-v1"]');
  const cItem = document.querySelector('[data-oly-id="p-c1"]');
  o.push('vItem: ' + !!vItem + ' cItem: ' + !!cItem);
  o.push('chart holder: ' + JSON.stringify(cItem && cItem._olyChart ? { pending: cItem._olyChart.pending, hasInst: !!cItem._olyChart.inst } : null));
  o.push('chart area html len: ' + (cItem ? cItem.innerHTML.length : -1));

  const body = document.querySelector('#ckEditorContainer .mce-content-body');
  o.push('body found: ' + !!body + ' inBlock: ' + (vItem && vItem.closest('.tmce-overlay-block') === blk.getBlockElement(bid)));

  const rect = vItem.getBoundingClientRect();
  vItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rect.left + 5, clientY: rect.top + 5, button: 0 }));
  o.push('mousedown 后 dragInfo: ' + !!share.getDragInfo());
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 45, clientY: rect.top + 45, button: 0 }));
  o.push('mousemove 后 data.x: ' + arr.find(d => d.id === 'p-v1').x + ' style.left: ' + vItem.style.left);
  await sleep(200);
  o.push('rAF 后 style.left: ' + vItem.style.left);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 45, clientY: rect.top + 45, button: 0 }));
  await sleep(100);
  o.push('mouseup 后 style.left: ' + vItem.style.left + ' leftPct: ' + arr.find(d => d.id === 'p-v1').leftPct);

  arr.length = 0;
  imgs.renderAll();
  const be = blk.getBlockElement(bid);
  if (be) be.remove();
  return o.join('\\n');
})()`));
console.log('---errors---');
console.log(errors.length ? errors.slice(0, 5).join('\n') : '(无)');
ws.close();
process.exit(0);
