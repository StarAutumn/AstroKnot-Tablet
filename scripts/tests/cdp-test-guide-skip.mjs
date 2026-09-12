// 实验：精确读 guide 标记 → 模拟点跳过按钮 → 读标记 → 判断写入是否生效
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

// 1) 精确读当前标记
const before = await ev2(`({
  completed: JSON.stringify(localStorage.getItem('astroknot_guide_done_v1.0.0')),
  allKeys: Object.keys(localStorage).filter(function (k) { return /guide/i.test(k); }),
})`);
console.log('实验前:', JSON.stringify(before));

// 2) 主动启动教程（模拟用户看到教程）→ 点跳过按钮 → 读标记
const test = await ev2(`(async () => {
  const g = await import('./modules/Guide/index.js');
  await g.startGuide();
  await new Promise(r => setTimeout(r, 3500)); // 等 overlay 挂载
  const skipBtn = document.getElementById('guideSkipBtn');
  if (!skipBtn) return { err: '跳过按钮不存在', overlayShown: !!document.querySelector('#guideOverlay') };
  skipBtn.click();
  await new Promise(r => setTimeout(r, 800));
  return {
    clicked: true,
    completedAfterSkip: JSON.stringify(localStorage.getItem('astroknot_guide_done_v1.0.0')),
    overlayStillVisible: (function () { var o = document.getElementById('guideOverlay'); return o ? getComputedStyle(o).display !== 'none' : false; })(),
  };
})()`);
console.log('跳过实验:', JSON.stringify(test));
ws.close();
setTimeout(() => process.exit(0), 300);
