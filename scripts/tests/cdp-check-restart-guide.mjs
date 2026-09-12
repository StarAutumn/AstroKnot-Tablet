// 重启后只读检查：教程标记能否从磁盘恢复（Map + 模块 isGuideCompleted 权威通道）
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
for (let i = 0; i < 30; i++) { if (await ev2('!!window.appState')) break; await sleep(1000); }
await sleep(3500); // 等教程启动判定时机过去

const state = await ev2(String.raw`(async () => {
  const g = await import('./modules/Guide/GuideCore.js');
  const ssf = window.SystemStorageFs;
  const mapKeys = ssf ? Array.from(ssf.getMap().keys()).filter(function (k) { return /guide/i.test(k); }) : [];
  const mapVals = {};
  mapKeys.forEach(function (k) { mapVals[k] = ssf.getMap().get(k); });
  return {
    isGuideCompleted: g.isGuideCompleted(),
    guideKeysInMap: mapKeys,
    guideValsInMap: mapVals,
    ssfKeyCount: ssf ? ssf.getMap().size : -1,
    overlayVisible: (function () { var o = document.getElementById('guideOverlay'); return o ? getComputedStyle(o).display !== 'none' : false; })(),
  };
})()`);
console.log('重启后状态:', JSON.stringify(state, null, 2));
console.log(state.isGuideCompleted && !state.overlayVisible ? '✅ 标记从磁盘恢复，重启不再弹教程' : '❌ 重启后教程仍弹出');
ws.close();
setTimeout(() => process.exit(0), 300);
