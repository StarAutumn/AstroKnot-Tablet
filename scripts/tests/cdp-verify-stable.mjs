// 稳定性复检 + 探针垃圾清理（只删诊断探针键，不碰用户数据）
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
await sleep(6000); // 等过教程判定窗口（await __storageReady + 2s）

const r = await ev2(String.raw`(async () => {
  const g = await import('./modules/Guide/GuideCore.js');
  const ssf = window.SystemStorageFs;
  const fsc = window.FSCore;
  // 清理历史诊断探针（仅探针，不碰用户数据）
  const junk = ['astroknot_diag_probe2', 'astroknot_test_key', 'astroknot_test_sys'];
  junk.forEach(function (k) { window.api.systemStorageRemoveSync(k); }); // removeSync → flush 删文件
  await ssf.flush();
  // 无 key 字段的裸探针文件直接删
  try { await fsc.remove('system/storage/QnBhcmVQcm9iZQ.json'); } catch (e) {}
  const state = {
    isGuideCompleted: g.isGuideCompleted(),
    guideVals: {
      done: ssf.getMap().get('astroknot_guide_done_v1.0.0'),
      step: ssf.getMap().get('astroknot_guide_step2_v1.0.0'),
    },
    overlayVisible: (function () { var o = document.getElementById('guideOverlay'); return o ? getComputedStyle(o).display !== 'none' : false; })(),
    mapCount: ssf.getMap().size,
    junkLeft: junk.filter(function (k) { return ssf.getMap().has(k); }),
  };
  return state;
})()`);
console.log('二次重启复检:', JSON.stringify(r, null, 2));
console.log(r.isGuideCompleted && !r.overlayVisible ? '✅ 稳定：教程标记持久，重启不再弹' : '❌ 不稳定');
ws.close();
setTimeout(() => process.exit(0), 300);
